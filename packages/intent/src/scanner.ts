import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  detectGlobalNodeModules,
  getDeps,
  listNodeModulesPackageDirs,
  parseFrontmatter,
  resolveDepDir,
} from './utils.js'
import type {
  IntentConfig,
  IntentPackage,
  NodeModulesScanTarget,
  ScanResult,
  SkillEntry,
} from './types.js'
import type { Dirent } from 'node:fs'

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

/**
 * Derive an IntentConfig from standard package.json fields when no explicit
 * `intent` field is present. A package with a `skills/` directory signals
 * intent support; `repo` and `docs` are derived from `repository` and
 * `homepage`.
 */
function deriveIntentConfig(
  pkgJson: Record<string, unknown>,
): IntentConfig | null {
  // Derive repo from repository field
  let repo: string | null = null
  if (typeof pkgJson.repository === 'string') {
    repo = pkgJson.repository
  } else if (
    pkgJson.repository &&
    typeof pkgJson.repository === 'object' &&
    typeof (pkgJson.repository as Record<string, unknown>).url === 'string'
  ) {
    repo = (pkgJson.repository as Record<string, unknown>).url as string
    // Normalize git+https://github.com/foo/bar.git → foo/bar
    repo = repo
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/github\.com\//, '')
  }

  // Derive docs from homepage field
  const docs =
    typeof pkgJson.homepage === 'string' ? pkgJson.homepage : undefined

  // Need at least a repo to be useful
  if (!repo) return null

  // Derive requires from intent.requires if partially present
  const intentPartial = pkgJson.intent as Record<string, unknown> | undefined
  const requires =
    intentPartial && Array.isArray(intentPartial.requires)
      ? intentPartial.requires.filter((r): r is string => typeof r === 'string')
      : undefined

  return {
    version: 1,
    repo,
    docs: docs ?? '',
    requires,
  }
}

// ---------------------------------------------------------------------------
// Skill discovery within a package
// ---------------------------------------------------------------------------

function discoverSkills(
  skillsDir: string,
  _baseName: string,
): Array<SkillEntry> {
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

function topoSort(packages: Array<IntentPackage>): Array<IntentPackage> {
  const byName = new Map(packages.map((p) => [p.name, p]))
  const visited = new Set<string>()
  const sorted: Array<IntentPackage> = []

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
  const globalNodeModules = detectGlobalNodeModules(packageManager)

  const packages: Array<IntentPackage> = []
  const warnings: Array<string> = []
  const nodeModules: ScanResult['nodeModules'] = {
    local: {
      path: nodeModulesDir,
      detected: true,
      exists: existsSync(nodeModulesDir),
      scanned: false,
    },
    global: {
      path: globalNodeModules.path,
      detected: Boolean(globalNodeModules.path),
      exists: globalNodeModules.path
        ? existsSync(globalNodeModules.path)
        : false,
      scanned: false,
      source: globalNodeModules.source,
    },
  }
  const resolutionRoots = [nodeModulesDir]

  if (
    nodeModules.global.exists &&
    nodeModules.global.path &&
    nodeModules.global.path !== nodeModulesDir
  ) {
    resolutionRoots.push(nodeModules.global.path)
  }

  if (!nodeModules.local.exists && !nodeModules.global.exists) {
    return { packageManager, packages, warnings, nodeModules }
  }
  const scanTargets: Array<NodeModulesScanTarget> = [
    nodeModules.local,
    nodeModules.global,
  ]

  // Track registered package names to avoid duplicates across phases
  const foundNames = new Set<string>()
  const packageRoots = new Map<string, string>()

  /**
   * Try to register a package with a skills/ directory. Reads its
   * package.json, validates intent config, discovers skills, and pushes
   * to `packages`. Returns true if the package was registered.
   */
  function tryRegister(dirPath: string, fallbackName: string): boolean {
    const skillsDir = join(dirPath, 'skills')
    if (!existsSync(skillsDir)) return false

    let pkgJson: Record<string, unknown>
    try {
      pkgJson = JSON.parse(readFileSync(join(dirPath, 'package.json'), 'utf8'))
    } catch {
      warnings.push(`Could not read package.json for ${dirPath}`)
      return false
    }

    const name = typeof pkgJson.name === 'string' ? pkgJson.name : fallbackName
    if (foundNames.has(name)) return false

    const intent =
      validateIntentField(name, pkgJson.intent) ?? deriveIntentConfig(pkgJson)
    if (!intent) {
      warnings.push(
        `${name} has a skills/ directory but could not determine repo/docs from package.json (add a "repository" field or explicit "intent" config)`,
      )
      return false
    }

    packages.push({
      name,
      version: typeof pkgJson.version === 'string' ? pkgJson.version : '0.0.0',
      intent,
      skills: discoverSkills(skillsDir, name),
    })
    foundNames.add(name)
    packageRoots.set(name, dirPath)
    return true
  }

  // Phase 1: Check each top-level package for skills/
  for (const target of scanTargets) {
    if (!target.path || !target.exists) continue
    target.scanned = true
    for (const dirPath of listNodeModulesPackageDirs(target.path)) {
      tryRegister(dirPath, 'unknown')
    }
  }

  // Phase 2: Walk dependency trees to discover transitive deps with skills.
  // This handles pnpm and other non-hoisted layouts where transitive deps
  // are not visible at the top level of node_modules.
  const walkVisited = new Set<string>()

  function walkDeps(pkgDir: string, pkgName: string): void {
    if (walkVisited.has(pkgName)) return
    walkVisited.add(pkgName)

    let pkgJson: Record<string, unknown>
    try {
      pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    } catch {
      warnings.push(
        `Could not read package.json for ${pkgName} (skipping dependency walk)`,
      )
      return
    }

    for (const depName of getDeps(pkgJson)) {
      if (foundNames.has(depName) || walkVisited.has(depName)) continue

      const depDir = resolveDepDir(depName, pkgDir, pkgName, resolutionRoots)
      if (!depDir) continue

      tryRegister(depDir, depName)
      walkDeps(depDir, depName)
    }
  }

  // Walk from packages found in Phase 1
  for (const pkg of [...packages]) {
    const pkgDir = packageRoots.get(pkg.name)
    if (pkgDir) {
      walkDeps(pkgDir, pkg.name)
    }
  }

  // Walk from project's direct deps that weren't found in Phase 1
  let projectPkg: Record<string, unknown> | null = null
  try {
    projectPkg = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    )
  } catch (err: unknown) {
    const isNotFound =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!isNotFound) {
      warnings.push(
        `Could not read project package.json: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (projectPkg) {
    for (const depName of getDeps(projectPkg, true)) {
      if (walkVisited.has(depName)) continue
      const depDir = resolutionRoots.find((candidateRoot) =>
        existsSync(join(candidateRoot, depName, 'package.json')),
      )
      if (depDir) {
        walkDeps(join(depDir, depName), depName)
      }
    }
  }

  // Sort by dependency order
  const sorted = topoSort(packages)

  return { packageManager, packages: sorted, warnings, nodeModules }
}
