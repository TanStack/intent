import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  createDependencyWalker,
  createPackageRegistrar,
} from './discovery/index.js'
import {
  detectGlobalNodeModules,
  parseFrontmatter,
  toPosixPath,
} from './utils.js'
import { findWorkspaceRoot } from './workspace-patterns.js'
import type {
  InstalledVariant,
  IntentConfig,
  IntentPackage,
  ScanOptions,
  ScanResult,
  ScanScope,
  SkillEntry,
  VersionConflict,
} from './types.js'

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

type PackageManager = ScanResult['packageManager']

interface PnpPackageLocator {
  name: string | null
  reference: string | null
}

interface PnpPackageInformation {
  packageLocation: string
  packageDependencies: Map<string, null | string | [string, string]>
}

interface PnpApi {
  getDependencyTreeRoots?: () => Array<PnpPackageLocator>
  getPackageInformation: (
    locator: PnpPackageLocator,
  ) => PnpPackageInformation | null
  findPackageLocator?: (location: string) => PnpPackageLocator | null
  setup?: () => void
  topLevel?: PnpPackageLocator
}

const requireFromHere = createRequire(import.meta.url)

function findPnpFile(start: string): string | null {
  let dir = resolve(start)

  while (true) {
    for (const fileName of ['.pnp.cjs', '.pnp.js']) {
      const pnpPath = join(dir, fileName)
      if (existsSync(pnpPath)) return pnpPath
    }

    const next = dirname(dir)
    if (next === dir) return null
    dir = next
  }
}

function isYarnPnpProject(root: string): boolean {
  return findPnpFile(root) !== null
}

function assertLocalNodeModulesSupported(root: string): void {
  if (
    existsSync(join(root, 'deno.json')) &&
    !existsSync(join(root, 'node_modules'))
  ) {
    throw new Error(
      'Deno without node_modules is not yet supported. Add `"nodeModulesDir": "auto"` to your deno.json to use intent.',
    )
  }
}

function detectPackageManager(root: string): PackageManager {
  const dirsToCheck = [root]
  const wsRoot = findWorkspaceRoot(root)
  if (wsRoot && wsRoot !== root) dirsToCheck.push(wsRoot)

  for (const dir of dirsToCheck) {
    if (isYarnPnpProject(dir)) return 'yarn'
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock')))
      return 'bun'
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  }
  return 'unknown'
}

function loadPnpApi(root: string): PnpApi | null {
  const pnpPath = findPnpFile(root)
  if (!pnpPath) return null

  try {
    const moduleApi = requireFromHere('node:module') as {
      findPnpApi?: (lookupSource: string) => PnpApi | null
    }
    const foundApi = moduleApi.findPnpApi?.(root)
    if (foundApi) return foundApi

    const pnpModule = requireFromHere(pnpPath) as PnpApi
    if (typeof pnpModule.setup === 'function') {
      pnpModule.setup()
    }

    if (
      typeof pnpModule.getDependencyTreeRoots === 'function' &&
      typeof pnpModule.getPackageInformation === 'function'
    ) {
      return pnpModule
    }

    const projectRequire = createRequire(join(dirname(pnpPath), 'package.json'))
    return projectRequire('pnpapi') as PnpApi
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Yarn PnP project detected, but Intent could not load Yarn's PnP API from ${pnpPath}: ${msg}`,
    )
  }
}

function getPnpLocatorKey(locator: PnpPackageLocator): string {
  return `${locator.name ?? '<top>'}@${locator.reference ?? '<top>'}`
}

function getPnpDependencyLocator(
  dependencyName: string,
  target: null | string | [string, string],
): PnpPackageLocator | null {
  if (target === null) return null
  if (Array.isArray(target)) {
    return { name: target[0], reference: target[1] }
  }
  return { name: dependencyName, reference: target }
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
        const relName = toPosixPath(relative(skillsDir, childDir))
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
      }
      // Always recurse into subdirectories so skills nested under
      // intermediate grouping directories (dirs without SKILL.md) are found.
      walk(childDir)
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

function getPackageDepth(packageRoot: string, projectRoot: string): number {
  return relative(projectRoot, packageRoot).split(sep).length
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: Array<string | number>
}

function parseSemver(version: string): ParsedSemver | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    )
  if (!match) return null

  const prerelease = match[4]
    ? match[4].split('.').map((identifier) => {
        return /^\d+$/.test(identifier) ? Number(identifier) : identifier
      })
    : []

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

function comparePrereleaseIdentifiers(
  a: string | number | undefined,
  b: string | number | undefined,
): number {
  if (a === undefined) return b === undefined ? 0 : 1
  if (b === undefined) return -1

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1

  return a.localeCompare(b)
}

function comparePackageVersions(a: string, b: string): number {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)

  if (!parsedA || !parsedB) {
    if (parsedA) return 1
    if (parsedB) return -1
    return 0
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    const diff = parsedA[key] - parsedB[key]
    if (diff !== 0) return diff
  }

  const length = Math.max(parsedA.prerelease.length, parsedB.prerelease.length)
  for (let i = 0; i < length; i++) {
    const diff = comparePrereleaseIdentifiers(
      parsedA.prerelease[i],
      parsedB.prerelease[i],
    )
    if (diff !== 0) return diff
  }

  return 0
}

function formatVariantWarning(
  name: string,
  variants: Array<InstalledVariant>,
  chosen: IntentPackage,
): string | null {
  const uniqueVersions = new Set(variants.map((variant) => variant.version))
  if (uniqueVersions.size <= 1) return null

  const details = variants
    .map((variant) => `${variant.version} at ${variant.packageRoot}`)
    .join(', ')

  return `Found ${variants.length} installed variants of ${name} across ${uniqueVersions.size} versions (${details}). Using ${chosen.version} from ${chosen.packageRoot}.`
}

function toVersionConflict(
  packageName: string,
  variants: Array<InstalledVariant>,
  chosen: IntentPackage,
): VersionConflict | null {
  const uniqueVersions = new Set(variants.map((variant) => variant.version))
  if (uniqueVersions.size <= 1) return null

  return {
    packageName,
    chosen: {
      version: chosen.version,
      packageRoot: chosen.packageRoot,
    },
    variants,
  }
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

function getScanScope(options: ScanOptions): ScanScope {
  return options.scope ?? (options.includeGlobal ? 'local-and-global' : 'local')
}

export function scanForIntents(
  root?: string,
  options: ScanOptions = {},
): ScanResult {
  const projectRoot = root ?? process.cwd()
  const scanScope = getScanScope(options)
  const packageManager = detectPackageManager(projectRoot)
  const nodeModulesDir = join(projectRoot, 'node_modules')
  const explicitGlobalNodeModules =
    process.env.INTENT_GLOBAL_NODE_MODULES?.trim() || null

  const packages: Array<IntentPackage> = []
  const warnings: Array<string> = []
  const conflicts: Array<VersionConflict> = []
  const nodeModules: ScanResult['nodeModules'] = {
    local: {
      path: nodeModulesDir,
      detected: true,
      exists: existsSync(nodeModulesDir),
      scanned: false,
    },
    global: {
      path: explicitGlobalNodeModules,
      detected: Boolean(explicitGlobalNodeModules),
      exists: explicitGlobalNodeModules
        ? existsSync(explicitGlobalNodeModules)
        : false,
      scanned: false,
      source: explicitGlobalNodeModules
        ? 'INTENT_GLOBAL_NODE_MODULES'
        : undefined,
    },
  }
  // Track registered package names to avoid duplicates across phases
  const packageIndexes = new Map<string, number>()
  const packageJsonCache = new Map<string, Record<string, unknown> | null>()
  const packageVariants = new Map<
    string,
    Map<string, { version: string; packageRoot: string }>
  >()
  let pnpApi: PnpApi | null | undefined

  function getPnpApi(): PnpApi | null {
    if (scanScope === 'global') return null
    if (pnpApi === undefined) {
      pnpApi = loadPnpApi(projectRoot)
    }
    return pnpApi
  }

  function rememberVariant(pkg: IntentPackage): void {
    let variants = packageVariants.get(pkg.name)
    if (!variants) {
      variants = new Map()
      packageVariants.set(pkg.name, variants)
    }
    variants.set(pkg.packageRoot, {
      version: pkg.version,
      packageRoot: pkg.packageRoot,
    })
  }

  function ensureGlobalNodeModules(): void {
    if (!nodeModules.global.path && !explicitGlobalNodeModules) {
      const detected = detectGlobalNodeModules(packageManager)
      nodeModules.global.path = detected.path
      nodeModules.global.source = detected.source
      nodeModules.global.detected = Boolean(detected.path)
      nodeModules.global.exists = detected.path
        ? existsSync(detected.path)
        : false
    }
  }

  function readPkgJson(dirPath: string): Record<string, unknown> | null {
    if (packageJsonCache.has(dirPath)) {
      return packageJsonCache.get(dirPath) ?? null
    }

    try {
      const pkgJson = JSON.parse(
        readFileSync(join(dirPath, 'package.json'), 'utf8'),
      ) as Record<string, unknown>
      packageJsonCache.set(dirPath, pkgJson)
      return pkgJson
    } catch {
      packageJsonCache.set(dirPath, null)
      return null
    }
  }

  const { scanTarget, tryRegister } = createPackageRegistrar({
    comparePackageVersions,
    deriveIntentConfig,
    discoverSkills,
    getPackageDepth,
    packageIndexes,
    packages,
    projectRoot,
    readPkgJson,
    rememberVariant,
    validateIntentField,
    warnings,
  })

  const { walkKnownPackages, walkProjectDeps, walkWorkspacePackages } =
    createDependencyWalker({
      packages,
      projectRoot,
      readPkgJson,
      tryRegister,
      warnings,
    })

  function scanPnpPackages(api: PnpApi): void {
    const visited = new Set<string>()
    const workspaceRoot = findWorkspaceRoot(projectRoot)
    const projectLocator = api.findPackageLocator?.(
      projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`,
    )
    const roots =
      workspaceRoot && workspaceRoot !== projectRoot && projectLocator
        ? [projectLocator]
        : (api.getDependencyTreeRoots?.() ??
          (api.topLevel ? [api.topLevel] : []))

    function visit(locator: PnpPackageLocator): void {
      const key = getPnpLocatorKey(locator)
      if (visited.has(key)) return
      visited.add(key)

      const info = api.getPackageInformation(locator)
      if (!info) return

      const packageRoot = info.packageLocation.replace(/[\\/]$/, '')
      tryRegister(packageRoot, locator.name ?? 'unknown')

      for (const [dependencyName, target] of info.packageDependencies) {
        const dependencyLocator = getPnpDependencyLocator(
          dependencyName,
          target,
        )
        if (dependencyLocator) visit(dependencyLocator)
      }
    }

    for (const locator of roots) {
      visit(locator)
    }
  }

  function scanLocalPackages(): void {
    if (!nodeModules.local.exists) {
      const api = getPnpApi()
      if (api) {
        scanPnpPackages(api)
        return
      }
    }

    assertLocalNodeModulesSupported(projectRoot)
    scanTarget(nodeModules.local)
    walkWorkspacePackages()
    walkKnownPackages()
    walkProjectDeps()
  }

  function scanGlobalPackages(): void {
    ensureGlobalNodeModules()
    scanTarget(nodeModules.global, 'global')
  }

  switch (scanScope) {
    case 'local':
      scanLocalPackages()
      break
    case 'local-and-global':
      scanLocalPackages()
      scanGlobalPackages()
      walkKnownPackages()
      walkProjectDeps()
      break
    case 'global':
      scanGlobalPackages()
      break
  }

  if (!nodeModules.local.exists && !nodeModules.global.exists) {
    return { packageManager, packages, warnings, conflicts, nodeModules }
  }

  for (const pkg of packages) {
    const variants = packageVariants.get(pkg.name)
    if (!variants) continue

    const conflict = toVersionConflict(pkg.name, [...variants.values()], pkg)
    if (conflict) {
      conflicts.push(conflict)
    }

    const warning = formatVariantWarning(pkg.name, [...variants.values()], pkg)
    if (warning) {
      warnings.push(warning)
    }
  }

  // Sort by dependency order
  const sorted = topoSort(packages)

  return { packageManager, packages: sorted, warnings, conflicts, nodeModules }
}
