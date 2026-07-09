import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { assertCanonicalPackageRelativePaths } from '../skill-path.js'
import { nodeReadFs } from '../../shared/utils.js'
import type { ReadFs } from '../../shared/utils.js'

export interface SkillContentEntry {
  relativePath: string
  absolutePath: string
}

export interface SourceContentHash {
  skills: Array<string>
  contentHash: string
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
): Buffer {
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
  return isBinaryContent(raw) ? raw : normalizeLineEndings(raw)
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
): Array<SkillContentEntry> {
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
    const absolutePath = join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(
        ...collectSupportFiles(fs, absolutePath, baseDir, realPackageRoot),
      )
      continue
    }
    if (dirent.isFile()) {
      files.push({
        relativePath: toPosixRelative(baseDir, absolutePath),
        absolutePath,
      })
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
          ...collectSupportFiles(fs, absolutePath, baseDir, realPackageRoot),
        )
      } else if (stat.isFile()) {
        files.push({
          relativePath: toPosixRelative(baseDir, absolutePath),
          absolutePath,
        })
      }
    }
  }

  return files
}

function collectSkillContentEntries(
  fs: ReadFs,
  packageRoot: string,
  entries: ReadonlyArray<SkillContentEntry>,
  realPackageRoot: string,
): Array<SkillContentEntry> {
  const contentEntries = [...entries]
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
        `Failed to read skill directory "${toPosixRelative(packageRoot, skillDir)}": ${err instanceof Error ? err.message : String(err)}`,
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
          `Failed to resolve skill directory "${toPosixRelative(packageRoot, supportDir)}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const stat = fs.lstatSync(realPath)
      if (stat.isDirectory()) {
        contentEntries.push(
          ...collectSupportFiles(fs, supportDir, packageRoot, realPackageRoot),
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

  const hashed = contentEntries.map((entry) => ({
    key: entry.relativePath,
    value: readSkillMdContent(
      fs,
      entry.absolutePath,
      realPackageRoot,
      entry.relativePath,
    ),
  }))

  return {
    skills: entries.map((entry) => entry.relativePath).toSorted(compareStrings),
    contentHash: hashEntries(hashed),
  }
}

function toPosixRelative(baseDir: string, absolutePath: string): string {
  const rel = relative(baseDir, absolutePath)
  return rel.split('\\').join('/')
}

function collectFilesRecursive(
  dir: string,
  baseDir: string,
): Array<SkillContentEntry> {
  const entries: Array<SkillContentEntry> = []
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, dirent.name)
    if (dirent.isDirectory()) {
      entries.push(...collectFilesRecursive(absolutePath, baseDir))
    } else if (dirent.isFile()) {
      entries.push({
        relativePath: toPosixRelative(baseDir, absolutePath),
        absolutePath,
      })
    }
  }
  return entries
}

// Manifest per-skill hash scope: the whole skill folder (SKILL.md plus any
// references/, assets/, scripts/), unlike the lockfile's per-package
// aggregate which is SKILL.md-only. Same canonical hashing rules (LF text
// normalization, byte-exact binary), different scope.
export function computeSkillFolderHash(
  skillDir: string,
  packageRoot: string,
): string {
  const realPackageRoot = nodeReadFs.realpathSync(packageRoot)
  const entries = collectFilesRecursive(skillDir, skillDir)

  assertNoDuplicateKeys(
    entries.map((entry) => entry.relativePath),
    'skill folder path',
  )

  const hashed = entries.map((entry) => ({
    key: entry.relativePath,
    value: readSkillMdContent(
      nodeReadFs,
      entry.absolutePath,
      realPackageRoot,
      entry.relativePath,
    ),
  }))

  return hashEntries(hashed)
}
