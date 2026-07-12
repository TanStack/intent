import { createHash } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { assertCanonicalPackageRelativePaths } from '../skill-path.js'
import { nodeReadFs } from '../../shared/utils.js'
import type { ReadFs } from '../../shared/utils.js'
import type { Dirent } from 'node:fs'

export interface SkillContentEntry {
  relativePath: string
  absolutePath: string
}

export interface SourceContentHash {
  skills: Array<string>
  contentHash: string
}

export interface SkillFolderContentEntry {
  relativePath: string
  content: Buffer
}

const RECORD_SEPARATOR = Buffer.from([0])

export const HASH_LIMITS = {
  maxRecursionDepth: 32,
  maxFileCount: 1000,
  maxEntryCount: 1000,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
} as const

type HashCollectionState = {
  fileCount: number
  entryCount: number
}

type ReadSkillContent = {
  content: Buffer
  bytesRead: number
  isBinary: boolean
}

export type SourceContentReviewEntry = {
  relativePath: string
  content: Buffer
  contentHash: string
  isBinary: boolean
  byteLength: number
}

export function computeReviewedSourceContentHash(
  entries: ReadonlyArray<
    Pick<SourceContentReviewEntry, 'relativePath' | 'content'>
  >,
): string {
  return hashEntries(
    entries.map((entry) => ({
      key: entry.relativePath,
      value: entry.content,
    })),
  )
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Only valid UTF-8 without a NUL byte is normalized as text. Other content is
// binary for hashing purposes and must remain byte-exact.
function isBinaryContent(content: Buffer): boolean {
  return content.indexOf(0) !== -1 || !isUtf8(content)
}

// 'latin1' round-trips 1 byte to 1 codepoint, so replacing on the decoded
// string is byte-identical to a manual scan — safe for non-UTF8 content.
function normalizeLineEndings(content: Buffer): Buffer {
  const normalized = content.toString('latin1').replace(/\r\n|\r/g, '\n')
  return Buffer.from(normalized, 'latin1')
}

function isWithinDir(candidate: string, dir: string): boolean {
  const rel = relative(dir, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function assertNoDuplicateKeys(keys: Array<string>, label: string): void {
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`Invalid ${label}: duplicate path "${key}".`)
    }
    seen.add(key)
  }
}

function assertHashFileCount(fileCount: number): void {
  if (fileCount > HASH_LIMITS.maxFileCount) {
    throw new Error(
      `Hash file count limit (${HASH_LIMITS.maxFileCount}) exceeded.`,
    )
  }
}

function assertHashEntryCount(entryCount: number): void {
  if (entryCount > HASH_LIMITS.maxEntryCount) {
    throw new Error(
      `Hash entry count limit (${HASH_LIMITS.maxEntryCount}) exceeded.`,
    )
  }
}

function appendHashEntry(state: HashCollectionState): void {
  state.entryCount += 1
  assertHashEntryCount(state.entryCount)
}

function appendHashFile(
  files: Array<SkillContentEntry>,
  entry: SkillContentEntry,
  state: HashCollectionState,
): void {
  state.fileCount += 1
  assertHashFileCount(state.fileCount)
  files.push(entry)
}

// Values are length-prefixed because content can contain NUL bytes. Keys
// (package-relative paths) never can, but a JS string could, so that
// assumption is enforced here rather than just relied on.
function hashEntries(
  entries: ReadonlyArray<{ key: string; value: Buffer }>,
): string {
  const hash = createHash('sha256')
  const sorted = entries.toSorted((a, b) => compareStrings(a.key, b.key))

  for (const entry of sorted) {
    if (entry.key.includes('\0')) {
      throw new Error(
        `Invalid path "${entry.key}": must not contain a NUL byte.`,
      )
    }
    hash.update(Buffer.from(entry.key, 'utf8'))
    hash.update(RECORD_SEPARATOR)
    hash.update(Buffer.from(String(entry.value.length), 'ascii'))
    hash.update(RECORD_SEPARATOR)
    hash.update(entry.value)
    hash.update(RECORD_SEPARATOR)
  }

  return `sha256-${hash.digest('hex')}`
}

function readRegularFile(
  fs: ReadFs,
  physicalPath: string,
  logicalRelativePath: string,
): Buffer {
  try {
    if (!fs.lstatSync(physicalPath).isFile()) {
      throw new Error('not a regular file.')
    }
    return fs.readFileSync(physicalPath)
  } catch (err) {
    throw new Error(
      `Failed to read skill file "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function readSkillMdContent(
  fs: ReadFs,
  absolutePath: string,
  realPackageRoot: string,
  logicalRelativePath: string,
): ReadSkillContent {
  let realPath: string
  try {
    realPath = fs.realpathSync(absolutePath)
  } catch (err) {
    throw new Error(
      `Failed to resolve skill file "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!isWithinDir(realPath, realPackageRoot)) {
    throw new Error(
      `Refusing to hash skill file: "${logicalRelativePath}" escapes the package root via a symlink.`,
    )
  }

  const raw = readRegularFile(fs, realPath, logicalRelativePath)
  if (raw.byteLength > HASH_LIMITS.maxFileBytes) {
    throw new Error(
      `Hash file size limit (${HASH_LIMITS.maxFileBytes} bytes) exceeded by "${logicalRelativePath}".`,
    )
  }
  const isBinary = isBinaryContent(raw)
  return {
    content: isBinary ? raw : normalizeLineEndings(raw),
    bytesRead: raw.byteLength,
    isBinary,
  }
}

function readHashEntries(
  entries: ReadonlyArray<SkillContentEntry>,
  fs: ReadFs,
  realPackageRoot: string,
): Array<{
  key: string
  value: Buffer
  isBinary: boolean
  byteLength: number
}> {
  let totalBytes = 0
  return entries.map((entry) => {
    const { content, bytesRead, isBinary } = readSkillMdContent(
      fs,
      entry.absolutePath,
      realPackageRoot,
      entry.relativePath,
    )
    totalBytes += bytesRead
    if (totalBytes > HASH_LIMITS.maxTotalBytes) {
      throw new Error(
        `Hash total size limit (${HASH_LIMITS.maxTotalBytes} bytes) exceeded.`,
      )
    }
    return {
      key: entry.relativePath,
      value: content,
      isBinary,
      byteLength: bytesRead,
    }
  })
}

function resolveContainedDirectory(
  fs: ReadFs,
  absolutePath: string,
  realPackageRoot: string,
  logicalRelativePath: string,
): string {
  let realPath: string
  try {
    realPath = fs.realpathSync(absolutePath)
  } catch (err) {
    throw new Error(
      `Failed to resolve skill directory "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!isWithinDir(realPath, realPackageRoot)) {
    throw new Error(
      `Refusing to hash skill directory: "${logicalRelativePath}" escapes the package root via a symlink.`,
    )
  }

  try {
    if (!fs.lstatSync(realPath).isDirectory()) {
      throw new Error('not a directory.')
    }
  } catch (err) {
    throw new Error(
      `Failed to read skill directory "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return realPath
}

function collectSupportFiles(
  fs: ReadFs,
  dir: string,
  baseDir: string,
  realPackageRoot: string,
  depth: number,
  state: HashCollectionState,
): Array<SkillContentEntry> {
  if (depth > HASH_LIMITS.maxRecursionDepth) {
    throw new Error(
      `Hash recursion depth limit (${HASH_LIMITS.maxRecursionDepth}) exceeded at "${toPosixRelative(baseDir, dir)}".`,
    )
  }
  const logicalRelativePath = toPosixRelative(baseDir, dir)
  const realDir = resolveContainedDirectory(
    fs,
    dir,
    realPackageRoot,
    logicalRelativePath,
  )

  let dirents: Array<Dirent<string>>
  try {
    dirents = fs.readdirSync(realDir, {
      withFileTypes: true,
      encoding: 'utf8',
    })
  } catch (err) {
    throw new Error(
      `Failed to read skill directory "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const files: Array<SkillContentEntry> = []
  for (const dirent of dirents) {
    appendHashEntry(state)
    const absolutePath = join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(
        ...collectSupportFiles(
          fs,
          absolutePath,
          baseDir,
          realPackageRoot,
          depth + 1,
          state,
        ),
      )
      continue
    }
    if (dirent.isFile()) {
      appendHashFile(
        files,
        {
          relativePath: toPosixRelative(baseDir, absolutePath),
          absolutePath,
        },
        state,
      )
      continue
    }
    if (dirent.isSymbolicLink()) {
      let realPath: string
      try {
        realPath = fs.realpathSync(absolutePath)
      } catch (err) {
        throw new Error(
          `Failed to resolve skill file "${toPosixRelative(baseDir, absolutePath)}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const stat = fs.lstatSync(realPath)
      if (stat.isDirectory()) {
        files.push(
          ...collectSupportFiles(
            fs,
            absolutePath,
            baseDir,
            realPackageRoot,
            depth + 1,
            state,
          ),
        )
      } else if (stat.isFile()) {
        appendHashFile(
          files,
          {
            relativePath: toPosixRelative(baseDir, absolutePath),
            absolutePath,
          },
          state,
        )
      }
    }
  }

  return files
}

function collectSkillContentEntries(
  fs: ReadFs,
  pathBaseDir: string,
  entries: ReadonlyArray<SkillContentEntry>,
  realPackageRoot: string,
): Array<SkillContentEntry> {
  const contentEntries = [...entries]
  const state = { fileCount: contentEntries.length, entryCount: 0 }
  assertHashFileCount(state.fileCount)
  for (const entry of entries) {
    const skillDir = dirname(entry.absolutePath)
    let dirents: Array<Dirent<string>>
    try {
      dirents = fs.readdirSync(skillDir, {
        withFileTypes: true,
        encoding: 'utf8',
      })
    } catch (err) {
      throw new Error(
        `Failed to read skill directory "${toPosixRelative(pathBaseDir, skillDir)}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    for (const dirent of dirents) {
      if (
        dirent.name !== 'references' &&
        dirent.name !== 'assets' &&
        dirent.name !== 'scripts'
      ) {
        continue
      }

      const supportDir = join(skillDir, dirent.name)
      let realPath: string
      try {
        realPath = fs.realpathSync(supportDir)
      } catch (err) {
        throw new Error(
          `Failed to resolve skill directory "${toPosixRelative(pathBaseDir, supportDir)}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const stat = fs.lstatSync(realPath)
      if (stat.isDirectory()) {
        contentEntries.push(
          ...collectSupportFiles(
            fs,
            supportDir,
            pathBaseDir,
            realPackageRoot,
            0,
            state,
          ),
        )
      }
    }
  }

  return contentEntries
}

export function computeSourceContentHash(
  packageRoot: string,
  entries: ReadonlyArray<SkillContentEntry>,
  fs: ReadFs = nodeReadFs,
): SourceContentHash {
  assertCanonicalPackageRelativePaths(
    entries.map((entry) => entry.relativePath),
    'skill path',
  )

  const realPackageRoot = fs.realpathSync(packageRoot)
  const contentEntries = collectSkillContentEntries(
    fs,
    packageRoot,
    entries,
    realPackageRoot,
  )
  assertNoDuplicateKeys(
    contentEntries.map((entry) => entry.relativePath),
    'skill content path',
  )

  const hashed = readHashEntries(contentEntries, fs, realPackageRoot)

  return {
    skills: entries.map((entry) => entry.relativePath).toSorted(compareStrings),
    contentHash: computeReviewedSourceContentHash(
      hashed.map((entry) => ({
        relativePath: entry.key,
        content: entry.value,
      })),
    ),
  }
}

export function readSourceContentForReview(
  packageRoot: string,
  entries: ReadonlyArray<SkillContentEntry>,
  fs: ReadFs = nodeReadFs,
): Array<SourceContentReviewEntry> {
  assertCanonicalPackageRelativePaths(
    entries.map((entry) => entry.relativePath),
    'skill path',
  )

  const realPackageRoot = fs.realpathSync(packageRoot)
  const contentEntries = collectSkillContentEntries(
    fs,
    packageRoot,
    entries,
    realPackageRoot,
  )
  assertNoDuplicateKeys(
    contentEntries.map((entry) => entry.relativePath),
    'skill content path',
  )

  return readHashEntries(contentEntries, fs, realPackageRoot)
    .map((entry) => ({
      relativePath: entry.key,
      content: entry.value,
      contentHash: `sha256-${createHash('sha256').update(entry.value).digest('hex')}`,
      isBinary: entry.isBinary,
      byteLength: entry.byteLength,
    }))
    .toSorted((a, b) => compareStrings(a.relativePath, b.relativePath))
}

function toPosixRelative(baseDir: string, absolutePath: string): string {
  const rel = relative(baseDir, absolutePath)
  return rel.split('\\').join('/')
}

// Manifest hashes cover one whole skill folder. Lockfile hashes aggregate the
// same content for every locked skill using package-relative paths. Both use
// the same canonical hashing rules (LF text normalization, byte-exact binary).
export function computeSkillFolderHash(
  skillDir: string,
  packageRoot: string,
  fs: ReadFs = nodeReadFs,
): string {
  return hashEntries(
    readSkillFolderContents(skillDir, packageRoot, fs).map((entry) => ({
      key: entry.relativePath,
      value: entry.content,
    })),
  )
}

export function readSkillFolderContents(
  skillDir: string,
  packageRoot: string,
  fs: ReadFs = nodeReadFs,
): Array<SkillFolderContentEntry> {
  const realPackageRoot = fs.realpathSync(packageRoot)
  const entries = collectSkillContentEntries(
    fs,
    skillDir,
    [
      {
        relativePath: 'SKILL.md',
        absolutePath: join(skillDir, 'SKILL.md'),
      },
    ],
    realPackageRoot,
  )

  assertNoDuplicateKeys(
    entries.map((entry) => entry.relativePath),
    'skill folder path',
  )

  return readHashEntries(entries, fs, realPackageRoot).map((entry) => ({
    relativePath: entry.key,
    content: entry.value,
  }))
}
