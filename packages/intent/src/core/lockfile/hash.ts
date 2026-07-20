import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { opendirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { nodeReadFs } from '../../shared/utils.js'
import type { Dirent } from 'node:fs'
import type { ReadFs } from '../../shared/utils.js'

const HASH_LIMITS = {
  maxRecursionDepth: 32,
  maxEntryCount: 1000,
  maxFileCount: 1000,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
} as const

export interface ComputeSkillContentHashOptions {
  packageRoot: string
  skillDir: string
  fs?: HashReadFs
}

type HashEntry = { path: string; content: Buffer }
type HashReadFs = ReadFs & { opendirSync?: typeof opendirSync }

const nodeHashReadFs: HashReadFs = { ...nodeReadFs, opendirSync }

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function normalizeContent(content: Buffer): Buffer {
  if (content.includes(0) || !isUtf8(content)) return content
  return Buffer.from(content.toString('utf8').replace(/\r\n|\r/g, '\n'), 'utf8')
}

function resolveInPackage(
  fs: ReadFs,
  filePath: string,
  packageRoot: string,
  label: string,
): string {
  let resolved: string
  try {
    resolved = fs.realpathSync(filePath)
  } catch (error) {
    throw new Error(
      `Failed to resolve ${label}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isWithin(packageRoot, resolved)) {
    throw new Error(`${label} escapes package root through a symlink.`)
  }
  return resolved
}

function hashEntries(entries: ReadonlyArray<HashEntry>): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((a, b) =>
    compareStrings(a.path, b.path),
  )) {
    const path = Buffer.from(entry.path, 'utf8')
    hash.update(Buffer.from(String(path.length), 'ascii'))
    hash.update(Buffer.from([0]))
    hash.update(path)
    hash.update(Buffer.from([0]))
    hash.update(Buffer.from(String(entry.content.length), 'ascii'))
    hash.update(Buffer.from([0]))
    hash.update(entry.content)
    hash.update(Buffer.from([0]))
  }
  return `sha256-${hash.digest('hex')}`
}

function readBoundedFile(fs: ReadFs, filePath: string): Buffer {
  const stats = fs.lstatSync(filePath)
  if (stats.size > HASH_LIMITS.maxFileBytes) {
    throw new Error(`Hash file size limit exceeded by ${filePath}.`)
  }
  const descriptor = fs.openSync!(filePath, 'r')
  const chunks: Array<Buffer> = []
  let total = 0
  try {
    for (;;) {
      const remaining = HASH_LIMITS.maxFileBytes + 1 - total
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining))
      const bytesRead = fs.readSync!(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > HASH_LIMITS.maxFileBytes) {
        throw new Error(`Hash file size limit exceeded by ${filePath}.`)
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync!(descriptor)
  }
  return Buffer.concat(chunks, total)
}

function readDirectoryEntries(
  fs: HashReadFs,
  path: string,
): Array<Dirent<string>> {
  if (!('opendirSync' in fs)) {
    return fs.readdirSync(path, { encoding: 'utf8', withFileTypes: true })
  }

  const directory = fs.opendirSync!(path, { encoding: 'utf8' })
  const entries: Array<Dirent<string>> = []
  try {
    for (;;) {
      const entry = directory.readSync()
      if (!entry) break
      entries.push(entry)
      if (entries.length > HASH_LIMITS.maxEntryCount) {
        throw new Error('Hash entry count limit exceeded.')
      }
    }
  } finally {
    directory.closeSync()
  }
  return entries
}

export function computeSkillContentHash({
  packageRoot,
  skillDir,
  fs = nodeHashReadFs,
}: ComputeSkillContentHashOptions): string {
  const realPackageRoot = resolveInPackage(
    fs,
    resolve(packageRoot),
    fs.realpathSync(resolve(packageRoot)),
    'package root',
  )
  const requestedSkillDir = isAbsolute(skillDir)
    ? resolve(skillDir)
    : resolve(packageRoot, skillDir)
  const realSkillDir = resolveInPackage(
    fs,
    requestedSkillDir,
    realPackageRoot,
    'skill directory',
  )
  if (!fs.lstatSync(realSkillDir).isDirectory()) {
    throw new Error('Skill directory is not a directory.')
  }
  const entries: Array<HashEntry> = []
  let entryCount = 0
  let totalBytes = 0

  const readFile = (physicalPath: string, logicalPath: string): void => {
    const realPath = resolveInPackage(
      fs,
      physicalPath,
      realPackageRoot,
      logicalPath,
    )
    if (!fs.lstatSync(realPath).isFile()) {
      throw new Error(`${logicalPath} is not a regular file.`)
    }
    const content = readBoundedFile(fs, realPath)
    totalBytes += content.length
    if (totalBytes > HASH_LIMITS.maxTotalBytes)
      throw new Error('Hash total size limit exceeded.')
    if (entries.length + 1 > HASH_LIMITS.maxFileCount)
      throw new Error('Hash file count limit exceeded.')
    entries.push({ path: logicalPath, content: normalizeContent(content) })
  }

  const collect = (
    physicalDir: string,
    logicalDir: string,
    depth: number,
  ): void => {
    if (depth > HASH_LIMITS.maxRecursionDepth)
      throw new Error('Hash recursion depth limit exceeded.')
    const dirEntries = readDirectoryEntries(fs, physicalDir)
    for (const entry of [...dirEntries].sort((a, b) =>
      compareStrings(a.name, b.name),
    )) {
      entryCount += 1
      if (entryCount > HASH_LIMITS.maxEntryCount)
        throw new Error('Hash entry count limit exceeded.')
      const logicalPath = `${logicalDir}/${entry.name}`
      const physicalPath = join(physicalDir, entry.name)
      const realPath = resolveInPackage(
        fs,
        physicalPath,
        realPackageRoot,
        logicalPath,
      )
      const stats = fs.lstatSync(realPath)
      if (stats.isDirectory()) {
        collect(realPath, logicalPath, depth + 1)
      } else if (stats.isFile()) {
        readFile(realPath, logicalPath)
      } else {
        throw new Error(`${logicalPath} is not a regular file or directory.`)
      }
    }
  }

  readFile(join(realSkillDir, 'SKILL.md'), 'SKILL.md')
  for (const directory of ['references', 'assets', 'scripts']) {
    const physicalDir = join(realSkillDir, directory)
    try {
      fs.lstatSync(physicalDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const realDir = resolveInPackage(
      fs,
      physicalDir,
      realPackageRoot,
      directory,
    )
    if (!fs.lstatSync(realDir).isDirectory())
      throw new Error(`${directory} is not a directory.`)
    collect(realDir, directory, 1)
  }
  return hashEntries(entries)
}
