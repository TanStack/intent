import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  getDeps,
  parseFrontmatter,
  readPkgJsonFile,
  resolveDepDir,
} from './utils.js'
import type { SkillEntry } from './types.js'
import type { Dirent } from 'node:fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LibraryPackage {
  name: string
  version: string
  description: string
  skills: Array<SkillEntry>
}

export interface LibraryScanResult {
  packages: Array<LibraryPackage>
  warnings: Array<string>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findHomeDir(scriptPath: string): string | null {
  let dir = dirname(scriptPath)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function isIntentPackage(pkg: Record<string, unknown>): boolean {
  const keywords = pkg.keywords
  if (Array.isArray(keywords) && keywords.includes('tanstack-intent')) {
    return true
  }
  // Legacy fallback: packages published before the keyword-based detection
  // change may only have bin.intent. Keep this until a breaking release.
  const bin = pkg.bin
  if (
    bin &&
    typeof bin === 'object' &&
    'intent' in (bin as Record<string, unknown>)
  ) {
    return true
  }
  return false
}

function discoverSkills(skillsDir: string): Array<SkillEntry> {
  const skills: Array<SkillEntry> = []

  function walk(dir: string): void {
    let entries: Array<Dirent<string>>
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childDir = join(dir, entry.name)
      const skillFile = join(childDir, 'SKILL.md')
      if (existsSync(skillFile)) {
        const fm = parseFrontmatter(skillFile)
        const relName = relative(skillsDir, childDir).split(sep).join('/')
        skills.push({
          name: typeof fm?.name === 'string' ? fm.name : relName,
          path: skillFile,
          description:
            typeof fm?.description === 'string'
              ? fm.description.replace(/\s+/g, ' ').trim()
              : '',
          type: typeof fm?.type === 'string' ? fm.type : undefined,
          framework:
            typeof fm?.framework === 'string' ? fm.framework : undefined,
        })
        walk(childDir)
      }
    }
  }

  walk(skillsDir)
  return skills
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export function scanLibrary(
  scriptPath: string,
  _projectRoot?: string,
): LibraryScanResult {
  const packages: Array<LibraryPackage> = []
  const warnings: Array<string> = []
  const visited = new Set<string>()

  const homeDir = findHomeDir(scriptPath)
  if (!homeDir) {
    return {
      packages,
      warnings: ['Could not determine home package directory'],
    }
  }

  const homePkg = readPkgJsonFile(homeDir)
  if (!homePkg) {
    return { packages, warnings: ['Could not read home package.json'] }
  }

  const homeName = typeof homePkg.name === 'string' ? homePkg.name : ''

  function processPackage(name: string, dir: string): void {
    if (visited.has(name)) return
    visited.add(name)

    const pkg = readPkgJsonFile(dir)
    if (!pkg) {
      warnings.push(`Could not read package.json for ${name}`)
      return
    }

    const skillsDir = join(dir, 'skills')
    packages.push({
      name,
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      description: typeof pkg.description === 'string' ? pkg.description : '',
      skills: existsSync(skillsDir) ? discoverSkills(skillsDir) : [],
    })

    for (const depName of getDeps(pkg)) {
      const depDir = resolveDepDir(depName, dir)
      if (!depDir) continue
      const depPkg = readPkgJsonFile(depDir)
      if (depPkg && isIntentPackage(depPkg)) {
        processPackage(depName, depDir)
      }
    }
  }

  processPackage(homeName, homeDir)
  return { packages, warnings }
}
