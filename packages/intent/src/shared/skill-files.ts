import { join } from 'node:path'
import { nodeReadFs } from './fs-identity.js'
import type { Dirent } from 'node:fs'
import type { ReadFs } from './fs-identity.js'

/**
 * Recursively find all SKILL.md files under a directory.
 */
export function findSkillFiles(
  dir: string,
  fs: ReadFs = nodeReadFs,
): Array<string> {
  const files: Array<string> = []
  collectSkillFiles(dir, fs, files)
  return files
}

function collectSkillFiles(
  dir: string,
  fs: ReadFs,
  files: Array<string>,
): void {
  let entries: Array<Dirent<string>>
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSkillFiles(fullPath, fs, files)
    } else if (entry.name === 'SKILL.md') {
      files.push(fullPath)
    }
  }
}

/**
 * Like `findSkillFiles`, but stops at the first SKILL.md found instead of
 * enumerating the whole tree.
 */
export function hasAnySkillFile(dir: string, fs: ReadFs = nodeReadFs): boolean {
  let entries: Array<Dirent<string>>
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return false
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (hasAnySkillFile(fullPath, fs)) return true
    } else if (entry.name === 'SKILL.md') {
      return true
    }
  }

  return false
}
