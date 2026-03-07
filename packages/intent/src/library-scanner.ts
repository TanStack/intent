import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { discoverSkills } from './scanner.js'
import type { SkillEntry } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LibraryPackage {
  name: string
  version: string
  description: string
  skills: SkillEntry[]
}

export interface LibraryScanResult {
  packages: LibraryPackage[]
  warnings: string[]
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
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

function getDeps(pkg: Record<string, unknown>): string[] {
  const seen = new Set<string>()
  for (const field of ['dependencies', 'peerDependencies']) {
    const d = pkg[field]
    if (d && typeof d === 'object') {
      for (const name of Object.keys(d as Record<string, string>)) {
        seen.add(name)
      }
    }
  }
  return [...seen]
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export function scanLibrary(
  scriptPath: string,
  projectRoot?: string,
): LibraryScanResult {
  const nodeModulesDir = join(projectRoot ?? process.cwd(), 'node_modules')
  const packages: LibraryPackage[] = []
  const warnings: string[] = []
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
      const depDir = join(nodeModulesDir, depName)
      if (!existsSync(depDir)) continue
      const depPkg = readPkgJson(depDir)
      if (depPkg && hasIntentBin(depPkg)) {
        processPackage(depName, depDir)
      }
    }
  }

  processPackage(homeName, homeDir)
  return { packages, warnings }
}
