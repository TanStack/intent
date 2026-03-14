import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { getDeps, parseFrontmatter, resolveDepDir } from './utils.js'
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

function readPkgJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function findHomeDir(scriptPath: string): string | null {
  let dir = dirname(scriptPath)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function hasIntentBin(pkg: Record<string, unknown>): boolean {
  const bin = pkg.bin
  if (!bin || typeof bin !== 'object') return false
  return 'intent' in (bin as Record<string, unknown>)
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

export async function scanLibrary(
  scriptPath: string,
  _projectRoot?: string,
): Promise<LibraryScanResult> {
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

  const homePkg = readPkgJson(homeDir)
  if (!homePkg) {
    return { packages, warnings: ['Could not read home package.json'] }
  }

  const homeName = typeof homePkg.name === 'string' ? homePkg.name : ''

  function processPackage(name: string, dir: string): void {
    if (visited.has(name)) return
    visited.add(name)

    const pkg = readPkgJson(dir)
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
      const depPkg = readPkgJson(depDir)
      if (depPkg && hasIntentBin(depPkg)) {
        processPackage(depName, depDir)
      }
    }
  }

  processPackage(homeName, homeDir)
  return { packages, warnings }
}
