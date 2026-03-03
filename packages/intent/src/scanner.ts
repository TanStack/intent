import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type {
  IntentConfig,
  IntentPackage,
  ScanResult,
  SkillEntry,
} from './types.js'
import { parseFrontmatter } from './utils.js'

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

type PackageManager = ScanResult['packageManager']

function detectPackageManager(root: string): PackageManager {
  // Check for unsupported environments first
  if (existsSync(join(root, '.pnp.cjs')) || existsSync(join(root, '.pnp.js'))) {
    throw new Error(
      'Yarn PnP is not yet supported. Add `nodeLinker: node-modules` to your .yarnrc.yml to use intent.',
    )
  }
  if (
    existsSync(join(root, 'deno.json')) &&
    !existsSync(join(root, 'node_modules'))
  ) {
    throw new Error(
      'Deno without node_modules is not yet supported. Add `"nodeModulesDir": "auto"` to your deno.json to use intent.',
    )
  }

  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock')))
    return 'bun'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Intent field validation
// ---------------------------------------------------------------------------

function validateIntentField(
  _pkgName: string,
  intent: unknown,
): IntentConfig | null {
  if (!intent || typeof intent !== 'object') return null
  const pb = intent as Record<string, unknown>

  if (pb.version !== 1) return null
  if (typeof pb.repo !== 'string' || !pb.repo) return null
  if (typeof pb.docs !== 'string' || !pb.docs) return null

  const requires = Array.isArray(pb.requires)
    ? pb.requires.filter((r): r is string => typeof r === 'string')
    : undefined

  return {
    version: 1,
    repo: pb.repo,
    docs: pb.docs,
    requires,
  }
}

// ---------------------------------------------------------------------------
// Skill discovery within a package
// ---------------------------------------------------------------------------

function discoverSkills(skillsDir: string, _baseName: string): SkillEntry[] {
  const skills: SkillEntry[] = []

  function walk(dir: string): void {
    let entries: Dirent<string>[]
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
        const desc =
          typeof fm?.description === 'string'
            ? fm.description.replace(/\s+/g, ' ').trim()
            : ''
        skills.push({
          name: typeof fm?.name === 'string' ? fm.name : relName,
          path: skillFile,
          description: desc,
          type: typeof fm?.type === 'string' ? fm.type : undefined,
          framework:
            typeof fm?.framework === 'string' ? fm.framework : undefined,
        })
        // Recurse for sub-skills
        walk(childDir)
      }
    }
  }

  walk(skillsDir)
  return skills
}

// ---------------------------------------------------------------------------
// Topological sort on requires
// ---------------------------------------------------------------------------

function topoSort(packages: IntentPackage[]): IntentPackage[] {
  const byName = new Map(packages.map((p) => [p.name, p]))
  const visited = new Set<string>()
  const sorted: IntentPackage[] = []

  function visit(name: string): void {
    if (visited.has(name)) return
    visited.add(name)
    const pkg = byName.get(name)
    if (!pkg) return
    for (const dep of pkg.intent.requires ?? []) {
      visit(dep)
    }
    sorted.push(pkg)
  }

  for (const pkg of packages) {
    visit(pkg.name)
  }
  return sorted
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export async function scanForIntents(root?: string): Promise<ScanResult> {
  const projectRoot = root ?? process.cwd()
  const packageManager = detectPackageManager(projectRoot)
  const nodeModulesDir = join(projectRoot, 'node_modules')

  const packages: IntentPackage[] = []
  const warnings: string[] = []

  if (!existsSync(nodeModulesDir)) {
    return { packageManager, packages, warnings }
  }

  // Collect all package directories to check
  const packageDirs: Array<{ dirPath: string }> = []

  let topEntries: Dirent<string>[]
  try {
    topEntries = readdirSync(nodeModulesDir, {
      withFileTypes: true,
      encoding: 'utf8',
    })
  } catch {
    return { packageManager, packages, warnings }
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue
    const dirPath = join(nodeModulesDir, entry.name)

    if (entry.name.startsWith('@')) {
      // Scoped package — check children
      let scopedEntries: Dirent<string>[]
      try {
        scopedEntries = readdirSync(dirPath, {
          withFileTypes: true,
          encoding: 'utf8',
        })
      } catch {
        continue
      }
      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory()) continue
        packageDirs.push({ dirPath: join(dirPath, scoped.name) })
      }
    } else if (!entry.name.startsWith('.')) {
      packageDirs.push({ dirPath })
    }
  }

  // Check each package for skills/
  for (const { dirPath } of packageDirs) {
    const skillsDir = join(dirPath, 'skills')
    if (!existsSync(skillsDir)) continue

    // Has skills/ — read package.json
    const pkgJsonPath = join(dirPath, 'package.json')
    let pkgJson: Record<string, unknown>
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    } catch {
      warnings.push(`Could not read package.json for ${dirPath}`)
      continue
    }

    const pkgName = typeof pkgJson.name === 'string' ? pkgJson.name : 'unknown'
    const pkgVersion =
      typeof pkgJson.version === 'string' ? pkgJson.version : '0.0.0'

    // Validate intent field
    const intent = validateIntentField(pkgName, pkgJson.intent)
    if (!intent) {
      warnings.push(
        `${pkgName} has a skills/ directory but missing or invalid "intent" field in package.json`,
      )
      continue
    }

    // Discover skills
    const skills = discoverSkills(skillsDir, pkgName)

    packages.push({
      name: pkgName,
      version: pkgVersion,
      intent,
      skills,
    })
  }

  // Sort by dependency order
  const sorted = topoSort(packages)

  return { packageManager, packages: sorted, warnings }
}
