import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validateSkillPath } from '../skill-path.js'
import { nodeReadFs } from '../../shared/utils.js'
import type { Dirent, Stats } from 'node:fs'
import type { ReadFs } from '../../shared/utils.js'

export const SKILL_HASH_LIMITS = {
  maxRecursionDepth: 32,
  maxEntryCount: 1000,
  maxFileCount: 1000,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxLogicalPathBytes: 1024,
} as const

interface SkillHashRecord {
  path: string
  normalizedContent: Buffer
}

interface CollectionState {
  entryCount: number
  fileCount: number
  totalBytes: number
  records: Array<SkillHashRecord>
}

type SkillHashFs = ReadFs &
  Required<
    Pick<
      ReadFs,
      'opendirSync' | 'openSync' | 'readSync' | 'closeSync' | 'fstatSync'
    >
  >

const READ_CHUNK_BYTES = 64 * 1024
const UTF8_DECODER = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
})

export function computeSkillContentHash({
  packageRoot,
  skillDir,
  fs = nodeReadFs,
}: {
  packageRoot: string
  skillDir: string
  fs?: ReadFs
}): string {
  if (
    !fs.opendirSync ||
    !fs.openSync ||
    !fs.readSync ||
    !fs.closeSync ||
    !fs.fstatSync
  ) {
    throw new Error('Skill hashing requires bounded filesystem reads')
  }
  const hashingFs = fs as SkillHashFs

  const unresolvedPackageRoot = resolve(packageRoot)
  const realPackageRoot = resolveRealPath(
    unresolvedPackageRoot,
    hashingFs,
    'Skill package root is unreadable',
  )
  const packageRootStats = readStats(
    realPackageRoot,
    hashingFs,
    'Skill package root is unreadable',
  )
  if (!packageRootStats.isDirectory()) {
    throw new Error('Skill package root must be a directory')
  }

  const unresolvedSkillRoot = isAbsolute(skillDir)
    ? resolve(skillDir)
    : resolve(unresolvedPackageRoot, skillDir)
  const realSkillRoot = resolveRealPath(
    unresolvedSkillRoot,
    hashingFs,
    'Skill root is unreadable',
  )
  assertInsidePackage(realPackageRoot, realSkillRoot)
  const skillRootStats = readStats(
    realSkillRoot,
    hashingFs,
    'Skill root is unreadable',
  )
  if (!skillRootStats.isDirectory()) {
    throw new Error('Skill root must be a directory')
  }

  const rootSkillPath = resolveRealPath(
    join(realSkillRoot, 'SKILL.md'),
    hashingFs,
    'Skill root SKILL.md is required',
  )
  assertInsidePackage(realPackageRoot, rootSkillPath)
  if (
    !readStats(
      rootSkillPath,
      hashingFs,
      'Skill root SKILL.md is unreadable',
    ).isFile()
  ) {
    throw new Error('Skill root SKILL.md must be a regular file')
  }

  const state: CollectionState = {
    entryCount: 0,
    fileCount: 0,
    totalBytes: 0,
    records: [],
  }
  const ancestors = new Set([realSkillRoot])
  collectDirectory(
    realPackageRoot,
    realSkillRoot,
    '',
    0,
    ancestors,
    state,
    hashingFs,
  )

  state.records.sort((left, right) => compareCodeUnits(left.path, right.path))
  const hash = createHash('sha256')
  for (const record of state.records) {
    const pathBytes = Buffer.from(record.path, 'utf8')
    hash.update(String(pathBytes.byteLength), 'utf8')
    hash.update('\0')
    hash.update(pathBytes)
    hash.update('\0')
    hash.update(String(record.normalizedContent.byteLength), 'utf8')
    hash.update('\0')
    hash.update(record.normalizedContent)
    hash.update('\0')
  }

  return `sha256-${hash.digest('hex')}`
}

function collectDirectory(
  realPackageRoot: string,
  realDirectory: string,
  logicalPrefix: string,
  depth: number,
  ancestors: Set<string>,
  state: CollectionState,
  fs: SkillHashFs,
): void {
  if (depth > SKILL_HASH_LIMITS.maxRecursionDepth) {
    throw new Error('Skill hash recursion depth limit exceeded')
  }
  assertInsidePackage(realPackageRoot, realDirectory)
  if (logicalPrefix !== '') validateLogicalPath(logicalPrefix)

  const { entries, exceededLimit } = readDirectoryEntries(
    realDirectory,
    state,
    fs,
  )
  entries.sort((left, right) => compareCodeUnits(left.name, right.name))

  if (exceededLimit) {
    throw new Error('Skill hash entry count limit exceeded')
  }

  for (const entry of entries) {
    const logicalPath = logicalPrefix
      ? `${logicalPrefix}/${entry.name}`
      : entry.name
    validateLogicalPath(logicalPath)

    const realTarget = resolveRealPath(
      join(realDirectory, entry.name),
      fs,
      'Skill content is unreadable',
    )
    assertInsidePackage(realPackageRoot, realTarget)
    const stats = readStats(realTarget, fs, 'Skill content is unreadable')

    if (stats.isDirectory()) {
      if (ancestors.has(realTarget)) {
        throw new Error('Skill content contains a directory cycle')
      }
      ancestors.add(realTarget)
      try {
        collectDirectory(
          realPackageRoot,
          realTarget,
          logicalPath,
          depth + 1,
          ancestors,
          state,
          fs,
        )
      } finally {
        ancestors.delete(realTarget)
      }
      continue
    }

    if (!stats.isFile()) {
      throw new Error('Skill content contains a special file')
    }

    state.fileCount += 1
    if (state.fileCount > SKILL_HASH_LIMITS.maxFileCount) {
      throw new Error('Skill hash file count limit exceeded')
    }

    const content = readBoundedFile(realTarget, stats, fs)
    state.totalBytes += content.byteLength
    if (state.totalBytes > SKILL_HASH_LIMITS.maxTotalBytes) {
      throw new Error('Skill hash total size limit exceeded')
    }
    state.records.push({
      path: logicalPath,
      normalizedContent: normalizeContent(content),
    })
  }
}

function readDirectoryEntries(
  realDirectory: string,
  state: CollectionState,
  fs: SkillHashFs,
): { entries: Array<Dirent<string>>; exceededLimit: boolean } {
  let directory: ReturnType<SkillHashFs['opendirSync']>
  try {
    directory = fs.opendirSync(realDirectory, { encoding: 'utf8' })
  } catch {
    throw new Error('Skill content is unreadable')
  }

  const entries: Array<Dirent<string>> = []
  let exceededLimit = false
  let closeFailed = false
  try {
    for (;;) {
      let entry: Dirent<string> | null
      try {
        entry = directory.readSync()
      } catch {
        throw new Error('Skill content is unreadable')
      }
      if (entry === null) break

      state.entryCount += 1
      entries.push(entry)
      if (state.entryCount > SKILL_HASH_LIMITS.maxEntryCount) {
        exceededLimit = true
        break
      }
    }
  } finally {
    try {
      directory.closeSync()
    } catch {
      closeFailed = true
    }
  }
  if (closeFailed) throw new Error('Skill content is unreadable')

  return { entries, exceededLimit }
}

function readBoundedFile(path: string, stats: Stats, fs: SkillHashFs): Buffer {
  if (stats.size > SKILL_HASH_LIMITS.maxFileBytes) {
    throw new Error('Skill hash file size limit exceeded')
  }

  let fileDescriptor: number
  try {
    fileDescriptor = fs.openSync(path, 'r')
  } catch {
    throw new Error('Skill content is unreadable')
  }

  const chunks: Array<Buffer> = []
  let totalBytes = 0
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  let closeFailed = false
  try {
    let openedStats: Stats
    try {
      openedStats = fs.fstatSync(fileDescriptor)
    } catch {
      throw new Error('Skill content is unreadable')
    }
    if (!isSameRegularFile(stats, openedStats)) {
      throw new Error('Skill content changed during hashing')
    }
    if (openedStats.size > SKILL_HASH_LIMITS.maxFileBytes) {
      throw new Error('Skill hash file size limit exceeded')
    }

    while (totalBytes <= SKILL_HASH_LIMITS.maxFileBytes) {
      const remaining = SKILL_HASH_LIMITS.maxFileBytes + 1 - totalBytes
      let bytesRead: number
      try {
        bytesRead = fs.readSync(
          fileDescriptor,
          chunk,
          0,
          Math.min(chunk.byteLength, remaining),
          null,
        )
      } catch {
        throw new Error('Skill content is unreadable')
      }
      if (bytesRead === 0) break

      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)))
      totalBytes += bytesRead
      if (totalBytes > SKILL_HASH_LIMITS.maxFileBytes) {
        throw new Error('Skill hash file size limit exceeded')
      }
    }

    let finalStats: Stats
    try {
      finalStats = fs.fstatSync(fileDescriptor)
    } catch {
      throw new Error('Skill content is unreadable')
    }
    if (!isSameRegularFile(openedStats, finalStats)) {
      throw new Error('Skill content changed during hashing')
    }
  } finally {
    try {
      fs.closeSync(fileDescriptor)
    } catch {
      closeFailed = true
    }
  }
  if (closeFailed) throw new Error('Skill content is unreadable')

  return Buffer.concat(chunks, totalBytes)
}

function isSameRegularFile(expected: Stats, actual: Stats): boolean {
  return (
    actual.isFile() &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino
  )
}

function normalizeContent(content: Buffer): Buffer {
  try {
    const text = UTF8_DECODER.decode(content)
    return Buffer.from(text.replace(/\r\n|\r/g, '\n'), 'utf8')
  } catch {
    return content
  }
}

function validateLogicalPath(path: string): void {
  if (Buffer.byteLength(path, 'utf8') > SKILL_HASH_LIMITS.maxLogicalPathBytes) {
    throw new Error('Skill hash logical path limit exceeded')
  }
  validateSkillPath(path)
}

function resolveRealPath(path: string, fs: ReadFs, message: string): string {
  try {
    return fs.realpathSync(path)
  } catch {
    throw new Error(message)
  }
}

function readStats(path: string, fs: ReadFs, message: string): Stats {
  try {
    return fs.lstatSync(path)
  } catch {
    throw new Error(message)
  }
}

function assertInsidePackage(realPackageRoot: string, target: string): void {
  const relativeTarget = relative(realPackageRoot, target)
  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('Skill content escapes package root')
  }
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
