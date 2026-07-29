import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { isPathWithin, nodeReadFs } from '../../shared/utils.js'
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
  fs?: ReadFs
}

type HashEntry = { path: string; content: Buffer }
const HASH_ENTRY_SEPARATOR = Buffer.from([0])

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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
  if (!isPathWithin(packageRoot, resolved)) {
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
    hash.update(String(path.length), 'ascii')
    hash.update(HASH_ENTRY_SEPARATOR)
    hash.update(path)
    hash.update(HASH_ENTRY_SEPARATOR)
    hash.update(String(entry.content.length), 'ascii')
    hash.update(HASH_ENTRY_SEPARATOR)
    hash.update(entry.content)
    hash.update(HASH_ENTRY_SEPARATOR)
  }
  return `sha256-${hash.digest('hex')}`
}

function readBoundedFile(fs: ReadFs, filePath: string): Buffer {
  const stats = fs.lstatSync(filePath)
  if (stats.size > HASH_LIMITS.maxFileBytes) {
    throw new Error(`Hash file size limit exceeded by ${filePath}.`)
  }
  const { openSync, readSync, closeSync } = fs
  if (!openSync || !readSync || !closeSync) {
    const content = fs.readFileSync(filePath)
    if (content.length > HASH_LIMITS.maxFileBytes) {
      throw new Error(`Hash file size limit exceeded by ${filePath}.`)
    }
    return content
  }

  const descriptor = openSync(filePath, 'r')
  const chunks: Array<Buffer> = []
  let total = 0
  try {
    for (;;) {
      const remaining = HASH_LIMITS.maxFileBytes + 1 - total
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining))
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > HASH_LIMITS.maxFileBytes) {
        throw new Error(`Hash file size limit exceeded by ${filePath}.`)
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(descriptor)
  }
  return Buffer.concat(chunks, total)
}

function readDirectoryEntries(fs: ReadFs, path: string): Array<Dirent<string>> {
  if (!fs.opendirSync) {
    return fs.readdirSync(path, { encoding: 'utf8', withFileTypes: true })
  }

  const directory = fs.opendirSync(path, { encoding: 'utf8' })
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
  fs = nodeReadFs,
}: ComputeSkillContentHashOptions): string {
  const realPackageRoot = fs.realpathSync(resolve(packageRoot))
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
  const hashState: {
    entries: Array<HashEntry>
    entryCount: number
    totalBytes: number
  } = {
    entries: [],
    entryCount: 0,
    totalBytes: 0,
  }

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
    hashState.totalBytes += content.length
    if (hashState.totalBytes > HASH_LIMITS.maxTotalBytes)
      throw new Error('Hash total size limit exceeded.')
    if (hashState.entries.length + 1 > HASH_LIMITS.maxFileCount)
      throw new Error('Hash file count limit exceeded.')
    hashState.entries.push({
      path: logicalPath,
      content: normalizeContent(content),
    })
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
      hashState.entryCount += 1
      if (hashState.entryCount > HASH_LIMITS.maxEntryCount)
        throw new Error('Hash entry count limit exceeded.')
      const logicalPath = logicalDir
        ? `${logicalDir}/${entry.name}`
        : entry.name
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

  const skillFile = resolveInPackage(
    fs,
    join(realSkillDir, 'SKILL.md'),
    realPackageRoot,
    'SKILL.md',
  )
  if (!fs.lstatSync(skillFile).isFile())
    throw new Error('SKILL.md is not a regular file.')
  collect(realSkillDir, '', 0)
  return hashEntries(hashState.entries)
}
