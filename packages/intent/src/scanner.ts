// Static-discovery invariant: discovery reads package data as files and never
// executes discovered package code. The only sanctioned dynamic load is Yarn's
// PnP runtime (.pnp.cjs / pnpapi), used solely to map identities to readable
// roots. Enforced by the `intent/static-discovery` ESLint rule.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import semver from 'semver'
import {
  createDependencyWalker,
  createPackageRegistrar,
} from './discovery/index.js'
import {
  detectGlobalNodeModules,
  nodeReadFs,
  parseFrontmatter,
  toPosixPath,
} from './utils.js'
import { createIntentFsCache } from './fs-cache.js'
import { detectPackageManager } from './package-manager.js'
import { findWorkspaceRoot } from './workspace-patterns.js'
import type { IntentFsCache } from './fs-cache.js'
import type { ReadFs } from './utils.js'
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

type ScanOptionsWithFsCache = ScanOptions & {
  fsCache?: IntentFsCache
}

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

interface LoadedPnp {
  api: PnpApi
  /**
   * Yarn's libzip-patched `fs`, captured after `.pnp.cjs` `setup()` runs. The
   * scanner installs it as the active read filesystem so package roots inside
   * `.yarn/cache/*.zip` are readable.
   */
  readFs: ReadFs
}

interface NodeModuleInternals {
  _resolveFilename: (...args: Array<unknown>) => unknown
  findPnpApi?: (lookupSource: string) => PnpApi | null
}

const requireFromHere = createRequire(import.meta.url)

function findPnpFile(start: string): string | null {
  let dir = resolve(start)
  let prev: string | undefined

  while (dir !== prev) {
    for (const fileName of ['.pnp.cjs', '.pnp.js']) {
      const pnpPath = join(dir, fileName)
      if (existsSync(pnpPath)) return pnpPath
    }

    prev = dir
    dir = dirname(dir)
  }

  return null
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

function loadPnpApi(root: string): LoadedPnp | null {
  const pnpPath = findPnpFile(root)
  if (!pnpPath) return null

  const moduleApi = requireFromHere('node:module') as NodeModuleInternals
  const originalResolveFilename = moduleApi._resolveFilename
  // Capture `fs` before setup(). Yarn's `setup()` patches the `fs` module in
  // place (libzip layer for reading inside `.yarn/cache/*.zip`), so this
  // reference becomes patched without routing a post-setup `require('node:fs')`
  // through Yarn's resolver hook (which rejects the `node:fs` specifier under
  // Yarn 1 PnP).
  const readFs = requireFromHere('node:fs') as unknown as ReadFs

  try {
    // eslint-disable-next-line no-restricted-syntax -- sanctioned PnP runtime load
    const pnpModule = requireFromHere(pnpPath) as PnpApi
    if (typeof pnpModule.setup === 'function') {
      pnpModule.setup()
    }

    // setup() also installs a global CommonJS module-resolution hook. Restore
    // the resolver: Intent reads package data as files and never requires
    // candidate package code, so leaving the resolver installed is an
    // unnecessary, process-wide side effect (notably for a long-running
    // `mcp serve`). The in-place `fs` patch survives the restore.
    moduleApi._resolveFilename = originalResolveFilename

    if (
      typeof pnpModule.getDependencyTreeRoots === 'function' &&
      typeof pnpModule.getPackageInformation === 'function'
    ) {
      return { api: pnpModule, readFs }
    }

    const projectRequire = createRequire(join(dirname(pnpPath), 'package.json'))
    return { api: projectRequire('pnpapi') as PnpApi, readFs }
  } catch (err) {
    moduleApi._resolveFilename = originalResolveFilename
    try {
      const foundApi = moduleApi.findPnpApi?.(root)
      if (foundApi) {
        return { api: foundApi, readFs }
      }
    } catch {
      // Ignore and report the project PnP load error below.
    }

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

function readSkillEntry(
  skillsDir: string,
  childDir: string,
  skillFile: string,
  readFs: ReadFs = nodeReadFs,
): SkillEntry {
  const fm = parseFrontmatter(skillFile, readFs)
  const relName = toPosixPath(relative(skillsDir, childDir))
  const desc =
    typeof fm?.description === 'string'
      ? fm.description.replace(/\s+/g, ' ').trim()
      : ''

  return {
    name: typeof fm?.name === 'string' ? fm.name : relName,
    path: skillFile,
    description: desc,
    type: typeof fm?.type === 'string' ? fm.type : undefined,
    framework: typeof fm?.framework === 'string' ? fm.framework : undefined,
  }
}

function discoverSkillByNameHint(
  skillsDir: string,
  packageName: string,
  skillNameHint: string,
  readFs: ReadFs = nodeReadFs,
): Array<SkillEntry> {
  const skills: Array<SkillEntry> = []
  const seen = new Set<string>()
  const skillNameHints = getSkillNameHints(packageName, skillNameHint)

  for (const hint of skillNameHints) {
    const resolvedHint = resolveSkillNameHintPath(skillsDir, hint)
    if (!resolvedHint) continue

    const { childDir, skillFile } = resolvedHint
    if (!readFs.existsSync(skillFile)) continue

    const skill = readSkillEntry(skillsDir, childDir, skillFile, readFs)
    if (skill.name !== hint || seen.has(skill.name)) continue

    seen.add(skill.name)
    skills.push(skill)
  }

  return skills
}

function discoverSkills(
  skillsDir: string,
  fsCache: IntentFsCache,
): Array<SkillEntry> {
  const readFs = fsCache.getReadFs()
  return fsCache
    .findSkillFiles(skillsDir)
    .flatMap((skillFile): Array<SkillEntry> => {
      const childDir = dirname(skillFile)
      if (childDir === skillsDir) return []
      return [readSkillEntry(skillsDir, childDir, skillFile, readFs)]
    })
}

function getPackageShortName(packageName: string): string {
  return packageName.split('/').pop() ?? packageName
}

function isWithinOrEqual(path: string, parentDir: string): boolean {
  const rel = relative(parentDir, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function resolveSkillNameHintPath(
  skillsDir: string,
  hint: string,
): { childDir: string; skillFile: string } | null {
  if (hint.startsWith('/') || hint.startsWith('\\')) return null

  const parts = hint.split('/')
  if (
    parts.some(
      (part) =>
        part === '' || part === '.' || part === '..' || part.includes('\\'),
    )
  ) {
    return null
  }

  const resolvedSkillsDir = resolve(skillsDir)
  const childDir = resolve(resolvedSkillsDir, ...parts)
  if (!isWithinOrEqual(childDir, resolvedSkillsDir)) return null

  return {
    childDir,
    skillFile: join(childDir, 'SKILL.md'),
  }
}

function getSkillNameHints(
  packageName: string,
  skillNameHint: string,
): Array<string> {
  const packageShortName = getPackageShortName(packageName)
  if (skillNameHint.startsWith(`${packageShortName}/`)) {
    return [skillNameHint]
  }

  return [skillNameHint, `${packageShortName}/${skillNameHint}`]
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

function normalizeVersion(version: string): string | null {
  const validVersion = semver.valid(version)
  if (validVersion) return validVersion

  return semver.coerce(version)?.version ?? null
}

function comparePackageVersions(a: string, b: string): number {
  const versionA = normalizeVersion(a)
  const versionB = normalizeVersion(b)

  if (!versionA || !versionB) {
    if (versionA) return 1
    if (versionB) return -1
    return 0
  }

  return semver.compare(versionA, versionB)
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
  const fsCache =
    (options as ScanOptionsWithFsCache).fsCache ?? createIntentFsCache()
  const workspaceRoot = findWorkspaceRoot(projectRoot)
  const packageManager = detectPackageManager(projectRoot, [workspaceRoot])
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
  const packageVariants = new Map<
    string,
    Map<string, { version: string; packageRoot: string }>
  >()
  let pnpApi: PnpApi | null | undefined

  function getPnpApi(): PnpApi | null {
    if (scanScope === 'global') return null
    if (pnpApi === undefined) {
      const loaded = loadPnpApi(projectRoot)
      pnpApi = loaded?.api ?? null
      // Install Yarn's libzip-patched fs before any package inside the zip
      // cache is read (scanPnpPackages runs after this).
      if (loaded) fsCache.useFs(loaded.readFs)
    }
    return pnpApi
  }

  function getStats(): ScanResult['stats'] {
    return fsCache.getStats()
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
    return fsCache.readPackageJson(dirPath)
  }

  const { scanNodeModulesDir, scanTarget, tryRegister } =
    createPackageRegistrar({
      comparePackageVersions,
      deriveIntentConfig,
      discoverSkills: (skillsDir) => discoverSkills(skillsDir, fsCache),
      getPackageDepth,
      getFsIdentity: fsCache.getFsIdentity,
      exists: fsCache.exists,
      packageIndexes,
      packages,
      projectRoot,
      readPkgJson,
      rememberVariant,
      validateIntentField,
      warnings,
    })

  const {
    scanNestedNodeModulesDir,
    walkKnownPackages,
    walkProjectDeps,
    walkWorkspacePackages,
  } = createDependencyWalker({
    fsCache,
    getFsIdentity: fsCache.getFsIdentity,
    packages,
    projectRoot,
    readPkgJson,
    scanNodeModulesDir,
    tryRegister,
    warnings,
  })

  function scanPnpPackages(api: PnpApi): void {
    const visited = new Set<string>()
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
    const packageCountBeforeLocalDiscovery = packages.length
    walkWorkspacePackages()
    const packageCountBeforeDependencyDiscovery = packages.length
    scanTarget(nodeModules.local)
    walkKnownPackages()
    walkProjectDeps()
    const shouldTryPnpFallback =
      packages.length === packageCountBeforeDependencyDiscovery

    if (
      nodeModules.local.path &&
      nodeModules.local.exists &&
      packages.length === packageCountBeforeLocalDiscovery
    ) {
      scanNestedNodeModulesDir(nodeModules.local.path)
    }

    if (shouldTryPnpFallback) {
      const api = getPnpApi()
      if (api) {
        scanPnpPackages(api)
      }
    }
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
    return {
      packageManager,
      packages,
      warnings,
      notices: [],
      conflicts,
      nodeModules,
      stats: getStats(),
    }
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

  return {
    packageManager,
    packages: sorted,
    warnings,
    notices: [],
    conflicts,
    nodeModules,
    stats: getStats(),
  }
}

export interface ScanIntentPackageAtRootOptions {
  fallbackName?: string
  fsCache?: IntentFsCache
  projectRoot?: string
  source?: IntentPackage['source']
  skillNameHint?: string
}

export interface ScanIntentPackageAtRootResult {
  package: IntentPackage | null
  warnings: Array<string>
}

export function scanIntentPackageAtRoot(
  packageRoot: string,
  options: ScanIntentPackageAtRootOptions = {},
): ScanIntentPackageAtRootResult {
  const projectRoot = options.projectRoot ?? packageRoot
  const packages: Array<IntentPackage> = []
  const warnings: Array<string> = []
  const packageIndexes = new Map<string, number>()
  const fsCache = options.fsCache ?? createIntentFsCache()

  function readPkgJson(dirPath: string): Record<string, unknown> | null {
    return fsCache.readPackageJson(dirPath)
  }

  const { tryRegister } = createPackageRegistrar({
    comparePackageVersions,
    deriveIntentConfig,
    discoverSkills: options.skillNameHint
      ? (skillsDir, packageName) =>
          discoverSkillByNameHint(
            skillsDir,
            packageName,
            options.skillNameHint!,
            fsCache.getReadFs(),
          )
      : (skillsDir) => discoverSkills(skillsDir, fsCache),
    getPackageDepth,
    getFsIdentity: fsCache.getFsIdentity,
    exists: fsCache.exists,
    packageIndexes,
    packages,
    projectRoot,
    readPkgJson,
    rememberVariant() {},
    validateIntentField,
    warnings,
  })

  tryRegister(
    packageRoot,
    options.fallbackName ?? 'unknown',
    options.source ?? 'local',
  )

  return {
    package: packages[0] ?? null,
    warnings,
  }
}
