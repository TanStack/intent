// Static-discovery invariant: discovery reads package data as files and never
// executes discovered package code. The only sanctioned dynamic load is Yarn's
// PnP runtime (.pnp.cjs / pnpapi), used solely to map identities to readable
// roots. Enforced by the `intent/static-discovery` ESLint rule.
import { constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { errorMessage, isRecord } from '../shared/guards.js'
import { isWithinOrEqual, toPosixPath } from '../shared/paths.js'
import { detectGlobalNodeModules } from '../shared/node-modules.js'
import { parseFrontmatter, readScalarField } from '../shared/frontmatter.js'
import {
  findWorkspacePackages,
  findWorkspaceRoot,
  readWorkspacePatterns,
} from '../core/workspace-patterns.js'
import { compareVersions, normalizeVersion } from '../shared/version.js'
import { getPackageShortName } from '../skills/use.js'
import { createIntentFsCache } from './fs-cache.js'
import { detectPackageManager } from './package-manager.js'
import { createPackageRegistrar } from './register.js'
import { createDependencyWalker } from './walk.js'
import type { IntentFsCache } from './fs-cache.js'
import type { ReadFs } from '../shared/fs-identity.js'
import type {
  InstalledVariant,
  IntentConfig,
  IntentPackage,
  ScanOptions,
  ScanResult,
  ScanScope,
  SkillEntry,
  VersionConflict,
} from '../shared/types.js'

export type ScanOptionsWithFsCache = ScanOptions & {
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

export function isPnpRuntimeWithinNodeModules(pnpPath: string): boolean {
  return resolve(pnpPath).split(sep).includes('node_modules')
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

  if (isPnpRuntimeWithinNodeModules(pnpPath)) {
    throw new Error(
      `Refusing to load a Yarn PnP runtime resolved from within node_modules: ${pnpPath}. Only a project root or ancestor .pnp.cjs is trusted.`,
    )
  }

  const moduleApi = requireFromHere('node:module') as NodeModuleInternals
  const originalResolveFilename = moduleApi._resolveFilename
  // Capture `fs` before setup(). Yarn's `setup()` patches the `fs` module in
  // place (libzip layer for reading inside `.yarn/cache/*.zip`), so this
  // reference becomes patched without routing a post-setup `require('node:fs')`
  // through Yarn's resolver hook (which rejects the `node:fs` specifier under
  // Yarn 1 PnP).
  const readFs: ReadFs = requireFromHere('node:fs')

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

    throw new Error(
      `Yarn PnP project detected, but Intent could not load Yarn's PnP API from ${pnpPath}: ${errorMessage(err)}`,
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

function validateIntentField(intent: unknown): IntentConfig | null {
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
  const { repository } = pkgJson
  let repo: string | null = null
  if (typeof repository === 'string') {
    repo = repository
  } else if (isRecord(repository) && typeof repository.url === 'string') {
    // Normalize git+https://github.com/foo/bar.git → foo/bar
    repo = repository.url
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/github\.com\//, '')
  }

  const docs =
    typeof pkgJson.homepage === 'string' ? pkgJson.homepage : undefined

  if (!repo) return null

  const requires =
    isRecord(pkgJson.intent) && Array.isArray(pkgJson.intent.requires)
      ? pkgJson.intent.requires.filter(
          (r): r is string => typeof r === 'string',
        )
      : undefined

  return {
    version: 1,
    repo,
    docs: docs ?? '',
    requires,
  }
}

/**
 * Real path of the package root that owns `skillsDir`, or null when it cannot
 * be resolved. Computed once per package: every skill entry is checked against
 * the same root.
 */
function resolveRealPackageRoot(
  skillsDir: string,
  readFs: ReadFs,
): string | null {
  try {
    return readFs.realpathSync.native(dirname(skillsDir))
  } catch {
    return null
  }
}

function readSkillEntry(
  skillsDir: string,
  realPackageRoot: string | null,
  childDir: string,
  skillFile: string,
  readFs: ReadFs,
): SkillEntry | null {
  if (!readFs.openSync || !readFs.fstatSync || !readFs.closeSync) return null
  if (realPackageRoot === null) return null
  let fd: number | undefined
  let fm: Record<string, unknown> | null
  try {
    const realSkillFile = readFs.realpathSync.native(skillFile)
    if (!isWithinOrEqual(realSkillFile, realPackageRoot)) return null
    const expected = readFs.lstatSync(realSkillFile)
    if (!expected.isFile()) return null
    if (readFs.realpathSync.native(realSkillFile) !== realSkillFile) return null

    fd = readFs.openSync(
      realSkillFile,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    const opened = readFs.fstatSync(fd)
    // Compare the opened file with the checked entry before reading any bytes.
    // The descriptor then survives pathname replacement, including parent swaps.
    // Node 23 and 24.0 to 24.1 report dev 0 from lstat on Windows.
    const sameDevice =
      opened.dev === expected.dev || opened.dev === 0 || expected.dev === 0
    if (!opened.isFile() || !sameDevice || opened.ino !== expected.ino)
      return null
    fm = parseFrontmatter(fd, readFs)
  } catch {
    return null
  } finally {
    if (fd !== undefined) readFs.closeSync(fd)
  }
  const relName = toPosixPath(relative(skillsDir, childDir))
  const desc =
    typeof fm?.description === 'string'
      ? fm.description.replace(/\s+/g, ' ').trim()
      : ''

  return {
    name: relName,
    path: skillFile,
    description: desc,
    purpose: readScalarField(fm, 'purpose'),
    type: readScalarField(fm, 'type'),
    framework: readScalarField(fm, 'framework'),
  }
}

function discoverSkillByNameHint(
  skillsDir: string,
  packageName: string,
  skillNameHint: string,
  readFs: ReadFs,
  includeMetadata: boolean,
): Array<SkillEntry> {
  const skills: Array<SkillEntry> = []
  const seen = new Set<string>()
  const skillNameHints = getSkillNameHints(packageName, skillNameHint)
  let realPackageRoot: string | null | undefined

  for (const hint of skillNameHints) {
    const resolvedHint = resolveSkillNameHintPath(skillsDir, hint)
    if (!resolvedHint) continue

    const { childDir, skillFile } = resolvedHint
    if (!readFs.existsSync(skillFile)) continue

    if (includeMetadata) {
      realPackageRoot ??= resolveRealPackageRoot(skillsDir, readFs)
    }
    // Keep the hinted identity so loading can report its existing path error,
    // without reading metadata from an unreadable or escaping target.
    const skill = (includeMetadata
      ? readSkillEntry(
          skillsDir,
          realPackageRoot ?? null,
          childDir,
          skillFile,
          readFs,
        )
      : null) ?? {
      name: hint,
      path: skillFile,
      description: '',
    }
    if (skill.name !== hint || seen.has(skill.name)) continue

    seen.add(skill.name)
    skills.push(skill)
  }

  return skills
}

function discoverSkills(
  skillsDir: string,
  packageName: string,
  fsCache: IntentFsCache,
  warnings: Array<string>,
): Array<SkillEntry> {
  const readFs = fsCache.getReadFs()
  const skillFiles = fsCache.findSkillFiles(skillsDir)
  const realPackageRoot =
    skillFiles.length > 0 ? resolveRealPackageRoot(skillsDir, readFs) : null
  return skillFiles.flatMap((skillFile): Array<SkillEntry> => {
    const childDir = dirname(skillFile)
    if (childDir === skillsDir) return []
    const skill = readSkillEntry(
      skillsDir,
      realPackageRoot,
      childDir,
      skillFile,
      readFs,
    )
    if (!skill) {
      warnings.push(
        `Skipped unreadable or out-of-package skill metadata for "${packageName}".`,
      )
      return []
    }
    return [skill]
  })
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

function comparePackageVersions(a: string, b: string): number {
  const versionA = normalizeVersion(a)
  const versionB = normalizeVersion(b)

  if (!versionA || !versionB) {
    if (versionA) return 1
    if (versionB) return -1
    return 0
  }

  return compareVersions(versionA, versionB)
}

function getScanScope(options: ScanOptions): ScanScope {
  return options.scope ?? (options.includeGlobal ? 'local-and-global' : 'local')
}

function createWorkspacePackageKeySet(
  workspaceRoot: string | null,
  fsCache: IntentFsCache,
  candidateRoot?: string,
): Set<string> {
  if (!workspaceRoot) return new Set()

  if (candidateRoot) {
    const patterns = readWorkspacePatterns(workspaceRoot, fsCache) ?? []
    const couldMatch = patterns.some((pattern) => {
      if (pattern.startsWith('!')) return false
      const segments = pattern.split('/')
      const wildcard = segments.findIndex(
        (segment) => segment === '*' || segment === '**',
      )
      if (
        wildcard < 0 ||
        segments
          .slice(wildcard)
          .some((segment) => !['*', '**'].includes(segment))
      )
        return true
      try {
        const readFs = fsCache.getReadFs()
        const prefix = readFs.realpathSync(
          join(workspaceRoot, ...segments.slice(0, wildcard)),
        )
        const candidate = readFs.realpathSync(candidateRoot)
        const path = relative(prefix, candidate)
        return (
          path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
        )
      } catch {
        return true
      }
    })
    if (!couldMatch) return new Set()
  }

  const packagesByParent = new Map<string, Array<string>>()
  for (const dir of findWorkspacePackages(workspaceRoot, fsCache)) {
    const parent = dirname(dir)
    const dirs = packagesByParent.get(parent)
    if (dirs) dirs.push(dir)
    else packagesByParent.set(parent, [dir])
  }

  const keys = new Set<string>()
  for (const [parent, dirs] of packagesByParent) {
    if (dirs.length === 1) {
      keys.add(fsCache.getFsIdentity(dirs[0]!))
      continue
    }
    const ordinaryEntries = new Set<string>()
    try {
      for (const entry of fsCache
        .getReadFs()
        .readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) ordinaryEntries.add(entry.name)
      }
    } catch {
      // Fall back to individual identity checks if the parent cannot be read.
    }
    // Directory entries supply the same symlink test as lstat, in one read
    // per parent. Refresh each invocation so retargeted links change kind.
    for (const dir of dirs) {
      keys.add(
        ordinaryEntries.has(basename(dir))
          ? resolve(dir)
          : fsCache.getFsIdentity(dir),
      )
    }
  }
  return keys
}

function createPackageKindResolver(
  workspacePackageKeys: Set<string>,
  getFsIdentity: (path: string) => string,
): (packageRoot: string) => IntentPackage['kind'] {
  if (workspacePackageKeys.size === 0) {
    return () => 'npm'
  }

  return (packageRoot: string): IntentPackage['kind'] => {
    return workspacePackageKeys.has(getFsIdentity(packageRoot))
      ? 'workspace'
      : 'npm'
  }
}

export function scanForIntents(
  root?: string,
  options: ScanOptions = {},
): ScanResult {
  const projectRoot = root ?? process.cwd()
  const scanScope = getScanScope(options)
  const fsCache =
    (options as ScanOptionsWithFsCache).fsCache ?? createIntentFsCache()
  const workspaceRoot = findWorkspaceRoot(projectRoot, fsCache)
  const packageManager = detectPackageManager(
    projectRoot,
    [workspaceRoot],
    fsCache,
  )
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
  const packageIndexes = new Map<string, number>()
  const packageVariants = new Map<string, Map<string, InstalledVariant>>()
  let pnpApi: PnpApi | null | undefined

  const getPackageKind = createPackageKindResolver(
    createWorkspacePackageKeySet(workspaceRoot, fsCache),
    fsCache.getFsIdentity,
  )

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
    if (!nodeModules.global.path) {
      const detected = detectGlobalNodeModules(packageManager)
      nodeModules.global.path = detected.path
      nodeModules.global.source = detected.source
      nodeModules.global.detected = Boolean(detected.path)
      nodeModules.global.exists = detected.path
        ? existsSync(detected.path)
        : false
    }
  }

  const { scanNodeModulesDir, scanTarget, tryRegister } =
    createPackageRegistrar({
      comparePackageVersions,
      deriveIntentConfig,
      discoverSkills: (skillsDir, packageName) =>
        discoverSkills(skillsDir, packageName, fsCache, warnings),
      getPackageDepth,
      getPackageKind,
      getFsIdentity: fsCache.getFsIdentity,
      exists: fsCache.exists,
      packageIndexes,
      packages,
      projectRoot,
      readPkgJson: fsCache.readPackageJson,
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
    primeFsIdentity: fsCache.primeFsIdentity,
    packages,
    projectRoot,
    readPkgJson: fsCache.readPackageJson,
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
      stats: fsCache.getStats(),
    }
  }

  for (const pkg of packages) {
    const variants = [...(packageVariants.get(pkg.name)?.values() ?? [])]
    const versions = new Set(variants.map((v) => v.version))
    if (versions.size <= 1) continue
    conflicts.push({
      packageName: pkg.name,
      chosen: { version: pkg.version, packageRoot: pkg.packageRoot },
      variants,
    })
    const details = variants
      .map((v) => `${v.version} at ${v.packageRoot}`)
      .join(', ')
    warnings.push(
      `Found ${variants.length} installed variants of ${pkg.name} across ${versions.size} versions (${details}). Using ${pkg.version} from ${pkg.packageRoot}.`,
    )
  }

  return {
    packageManager,
    packages: topoSort(packages),
    warnings,
    notices: [],
    conflicts,
    nodeModules,
    stats: fsCache.getStats(),
  }
}

export interface ScanIntentPackageAtRootOptions {
  fallbackName?: string
  fsCache?: IntentFsCache
  includeSkillMetadata?: boolean
  projectRoot?: string
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
  const getPackageKind = createPackageKindResolver(
    createWorkspacePackageKeySet(
      findWorkspaceRoot(projectRoot, fsCache),
      fsCache,
      packageRoot,
    ),
    fsCache.getFsIdentity,
  )

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
            options.includeSkillMetadata !== false,
          )
      : (skillsDir, packageName) =>
          discoverSkills(skillsDir, packageName, fsCache, warnings),
    getPackageDepth,
    getPackageKind,
    getFsIdentity: fsCache.getFsIdentity,
    exists: fsCache.exists,
    packageIndexes,
    packages,
    projectRoot,
    readPkgJson: fsCache.readPackageJson,
    rememberVariant() {},
    validateIntentField,
    warnings,
  })

  tryRegister(packageRoot, options.fallbackName ?? 'unknown')

  return {
    package: packages[0] ?? null,
    warnings,
  }
}
