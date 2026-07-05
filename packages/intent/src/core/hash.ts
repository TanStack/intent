import { createHash } from 'node:crypto'
import { isAbsolute, join, relative } from 'node:path'
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'

export interface SkillFile {
  relativePath: string
  content: Buffer
}

export interface SkillFolderHash {
  skillPath: string
  hash: string
}

const RECORD_SEPARATOR = Buffer.from([0])

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Full-buffer scan, not a fixed prefix: a partial scan can miss a NUL byte
// in a large binary asset, letting normalizeLineEndings corrupt real bytes.
function isBinaryContent(content: Buffer): boolean {
  return content.indexOf(0) !== -1
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

interface FileEntry {
  physicalPath: string
  logicalRelativePath: string
}

function readDirEntries(dir: string, logicalRelativePath: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    throw new Error(
      `Failed to list skill folder "${logicalRelativePath || '.'}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// Recurses through the resolved real path once validated, not the original
// symlink, to avoid a TOCTOU window between the check and the read.
function collectFileEntries(
  physicalDir: string,
  logicalPrefix: string,
  realRoot: string,
  ancestors: Set<string>,
): Array<FileEntry> {
  const entries = readDirEntries(physicalDir, logicalPrefix)
  const files: Array<FileEntry> = []

  for (const entry of entries) {
    const physicalEntryPath = join(physicalDir, entry.name)
    const logicalRelativePath = logicalPrefix
      ? `${logicalPrefix}/${entry.name}`
      : entry.name

    if (entry.isSymbolicLink()) {
      let realEntryPath: string
      try {
        realEntryPath = realpathSync(physicalEntryPath)
      } catch (err) {
        throw new Error(
          `Failed to resolve skill folder symlink "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      if (!isWithinDir(realEntryPath, realRoot)) {
        throw new Error(
          `Refusing to hash skill folder: "${logicalRelativePath}" escapes the skill folder via a symlink.`,
        )
      }

      const stats = statSync(realEntryPath)
      if (stats.isDirectory()) {
        if (ancestors.has(realEntryPath)) {
          throw new Error(
            `Refusing to hash skill folder: "${logicalRelativePath}" is a symlink cycle.`,
          )
        }
        ancestors.add(realEntryPath)
        files.push(
          ...collectFileEntries(
            realEntryPath,
            logicalRelativePath,
            realRoot,
            ancestors,
          ),
        )
        ancestors.delete(realEntryPath)
      } else if (stats.isFile()) {
        files.push({ physicalPath: realEntryPath, logicalRelativePath })
      }
      continue
    }

    if (entry.isDirectory()) {
      files.push(
        ...collectFileEntries(
          physicalEntryPath,
          logicalRelativePath,
          realRoot,
          ancestors,
        ),
      )
    } else if (entry.isFile()) {
      files.push({ physicalPath: physicalEntryPath, logicalRelativePath })
    }
  }

  return files
}

export function readSkillFolderFiles(skillDir: string): Array<SkillFile> {
  const realRoot = realpathSync(skillDir)
  const entries = collectFileEntries(
    realRoot,
    '',
    realRoot,
    new Set([realRoot]),
  )

  const files = entries.map(
    ({ physicalPath, logicalRelativePath }): SkillFile => {
      let raw: Buffer
      try {
        raw = readFileSync(physicalPath)
      } catch (err) {
        throw new Error(
          `Failed to read skill file "${logicalRelativePath}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      return {
        relativePath: logicalRelativePath,
        content: isBinaryContent(raw) ? raw : normalizeLineEndings(raw),
      }
    },
  )

  return files.sort((a, b) => compareStrings(a.relativePath, b.relativePath))
}

function assertValidRelativePath(path: string, label: string): void {
  if (path.length === 0) {
    throw new Error(`Invalid ${label}: path must not be empty.`)
  }
  if (isAbsolute(path)) {
    throw new Error(`Invalid ${label}: path must be relative, got "${path}".`)
  }
  if (path.includes('\\')) {
    throw new Error(
      `Invalid ${label}: path must use "/" separators, got "${path}".`,
    )
  }
  if (
    path
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Invalid ${label}: path must not contain "." or ".." segments, got "${path}".`,
    )
  }
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

// Values are length-prefixed because content can contain NUL bytes. Keys
// (real filesystem paths) never can, but a JS string could, so that
// assumption is enforced here rather than just relied on.
function hashEntries(
  entries: ReadonlyArray<{ key: string; value: Buffer }>,
): string {
  const hash = createHash('sha256')
  const sorted = [...entries].sort((a, b) => compareStrings(a.key, b.key))

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

export function hashSkillFolderFiles(files: ReadonlyArray<SkillFile>): string {
  for (const file of files) {
    assertValidRelativePath(file.relativePath, 'skill file path')
  }
  assertNoDuplicateKeys(
    files.map((file) => file.relativePath),
    'skill file path',
  )

  return hashEntries(
    files.map((file) => ({ key: file.relativePath, value: file.content })),
  )
}

export function hashSkillFolder(skillDir: string): string {
  return hashSkillFolderFiles(readSkillFolderFiles(skillDir))
}

export function hashSourceContent(
  skillHashes: ReadonlyArray<SkillFolderHash>,
): string {
  assertNoDuplicateKeys(
    skillHashes.map((entry) => entry.skillPath),
    'source skill path',
  )

  return hashEntries(
    skillHashes.map((entry) => ({
      key: entry.skillPath,
      value: Buffer.from(entry.hash, 'utf8'),
    })),
  )
}
