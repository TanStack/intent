import { isAbsolute, relative, resolve } from 'node:path'
import {
  compileExcludePatterns,
  getEffectiveExcludePatterns,
} from './core/excludes.js'
import { createIntentFsCache } from './fs-cache.js'
import { rewriteLoadedSkillMarkdownDestinations } from './core/markdown.js'
import { resolveSkillUseFastPath } from './core/load-resolution.js'
import { resolveProjectContext } from './core/project-context.js'
import {
  checkLoadAllowed,
  readSkillSourcesConfig,
  scanForPolicedIntents,
} from './core/source-policy.js'
import { ResolveSkillUseError, resolveSkillUse } from './resolver.js'
import { formatSkillUse, parseSkillUse } from './skill-use.js'
import type { ResolveSkillResult } from './resolver.js'
import type { IntentFsCache } from './fs-cache.js'
import type { ReadFs } from './utils.js'
import type { ScanOptions, ScanScope } from './types.js'
import type {
  IntentCoreErrorCode,
  IntentCoreOptions,
  IntentSkillList,
  IntentSkillSummary,
  LoadedIntentSkill,
  LoadedIntentSkillDebug,
  ResolvedIntentSkill,
} from './core/types.js'

export type {
  IntentCoreErrorCode,
  IntentCoreOptions,
  IntentPackageSummary,
  IntentSkillListDebug,
  IntentSkillList,
  IntentSkillSummary,
  LoadedIntentSkillDebug,
  LoadedIntentSkill,
  ResolvedIntentSkill,
} from './core/types.js'

export class IntentCoreError extends Error {
  readonly code: IntentCoreErrorCode
  readonly suggestedSkills?: Array<string>

  constructor(
    code: IntentCoreErrorCode,
    message: string,
    options: { suggestedSkills?: Array<string> } = {},
  ) {
    super(message)
    this.name = 'IntentCoreError'
    this.code = code
    if (options.suggestedSkills) {
      this.suggestedSkills = options.suggestedSkills
    }
  }
}

function toScanOptions(options: IntentCoreOptions): ScanOptions {
  if (options.global && options.globalOnly) {
    throw new IntentCoreError(
      'invalid-options',
      'Use either global or globalOnly, not both.',
    )
  }

  if (options.globalOnly) {
    return { scope: 'global' }
  }

  if (options.global) {
    return { scope: 'local-and-global' }
  }

  return { scope: 'local' }
}

function getScanScope(options: ScanOptions): ScanScope {
  return options.scope ?? (options.includeGlobal ? 'local-and-global' : 'local')
}

function withFsCache(
  options: ScanOptions,
  fsCache: IntentFsCache,
): ScanOptions & { fsCache: IntentFsCache } {
  return { ...options, fsCache }
}

function resolveCoreCwd(options: IntentCoreOptions): string {
  return resolve(process.cwd(), options.cwd ?? process.cwd())
}

export function listIntentSkills(
  options: IntentCoreOptions = {},
): IntentSkillList {
  const cwd = resolveCoreCwd(options)
  const scanOptions = toScanOptions(options)
  const fsCache = createIntentFsCache()
  const projectContext = resolveProjectContext({ cwd })
  const { scan, excludePatterns } = scanForPolicedIntents({
    cwd,
    scanOptions: withFsCache(scanOptions, fsCache),
    coreOptions: options,
    context: projectContext,
  })
  const packages = scan.packages
  const skills = packages.flatMap((pkg) =>
    pkg.skills.map((skill): IntentSkillSummary => {
      return {
        use: formatSkillUse(pkg.name, skill.name),
        packageName: pkg.name,
        packageRoot: pkg.packageRoot,
        packageVersion: pkg.version,
        packageSource: pkg.source,
        skillName: skill.name,
        description: skill.description,
        type: skill.type,
        framework: skill.framework,
      }
    }),
  )

  const result: IntentSkillList = {
    packageManager: scan.packageManager,
    skills,
    packages: packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      source: pkg.source,
      packageRoot: pkg.packageRoot,
      skillCount: pkg.skills.length,
    })),
    warnings: scan.warnings,
    notices: scan.notices,
    conflicts: scan.conflicts,
  }

  if (options.debug) {
    result.debug = {
      cwd,
      scope: getScanScope(scanOptions),
      excludes: excludePatterns,
      packageCount: result.packages.length,
      skillCount: result.skills.length,
      warningCount: result.warnings.length,
      noticeCount: result.notices.length,
      conflictCount: result.conflicts.length,
      scan: scan.stats ?? fsCache.getStats(),
    }
  }

  return result
}

function resolveFromCwd(cwd: string, path: string): string {
  return resolve(cwd, path)
}

function isResolvedPathInsidePackageRoot(
  path: string,
  packageRoot: string,
): boolean {
  const relativePath = relative(packageRoot, path)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function toResolvedIntentSkill(
  cwd: string,
  use: string,
  resolved: ResolveSkillResult,
  readFs: ReadFs,
  debug?: LoadedIntentSkillDebug,
): {
  realPackageRoot: string
  realResolvedPath: string
  readFs: ReadFs
  result: ResolvedIntentSkill
} {
  let realResolvedPath: string
  try {
    realResolvedPath = readFs.realpathSync.native(
      resolveFromCwd(cwd, resolved.path),
    )
  } catch {
    throw new IntentCoreError(
      'skill-file-not-found',
      `Resolved skill file was not found: ${resolved.path}`,
    )
  }
  const realPackageRoot = readFs.realpathSync.native(
    resolveFromCwd(cwd, resolved.packageRoot),
  )

  if (!isResolvedPathInsidePackageRoot(realResolvedPath, realPackageRoot)) {
    throw new IntentCoreError(
      'skill-path-outside-package',
      `Resolved skill path for "${use}" is outside package root: ${resolved.path}`,
    )
  }

  const result: ResolvedIntentSkill = {
    path: resolved.path,
    packageRoot: resolved.packageRoot,
    packageName: resolved.packageName,
    skillName: resolved.skillName,
    version: resolved.version,
    source: resolved.source,
    warnings: resolved.warnings,
    conflict: resolved.conflict,
  }

  if (debug) {
    result.debug = debug
  }

  return {
    realPackageRoot,
    realResolvedPath,
    readFs,
    result,
  }
}

function createLoadedSkillDebug({
  cwd,
  excludes,
  scan,
  resolution,
  resolved,
  scope,
}: {
  cwd: string
  excludes: Array<string>
  scan: LoadedIntentSkillDebug['scan']
  resolution: LoadedIntentSkillDebug['resolution']
  resolved: ResolveSkillResult
  scope: ScanScope
}): LoadedIntentSkillDebug {
  return {
    cwd,
    scope,
    resolution,
    excludes,
    packageName: resolved.packageName,
    skillName: resolved.skillName,
    version: resolved.version,
    source: resolved.source,
    path: resolved.path,
    warningCount: resolved.warnings.length,
    scan,
  }
}

function resolveIntentSkillInCwd(
  cwd: string,
  use: string,
  options: IntentCoreOptions = {},
): {
  realPackageRoot: string
  realResolvedPath: string
  readFs: ReadFs
  result: ResolvedIntentSkill
} {
  let parsedUse: ReturnType<typeof parseSkillUse>
  try {
    parsedUse = parseSkillUse(use)
  } catch (err) {
    throw new IntentCoreError(
      'invalid-skill-use',
      err instanceof Error ? err.message : String(err),
    )
  }

  const fsCache = createIntentFsCache()
  const projectContext = resolveProjectContext({ cwd })
  const excludePatterns = getEffectiveExcludePatterns(options, projectContext)
  const excludeMatchers = compileExcludePatterns(excludePatterns)
  const config = readSkillSourcesConfig(cwd, projectContext)

  const refusal = checkLoadAllowed(use, parsedUse, { config, excludeMatchers })
  if (refusal) {
    throw new IntentCoreError(refusal.code, refusal.message)
  }

  const scanOptions = toScanOptions(options)
  const scope = getScanScope(scanOptions)
  const fastPathResolved = resolveSkillUseFastPath(
    parsedUse,
    options,
    projectContext,
    cwd,
    fsCache,
  )
  if (fastPathResolved) {
    return toResolvedIntentSkill(
      cwd,
      use,
      fastPathResolved,
      fsCache.getReadFs(),
      options.debug
        ? createLoadedSkillDebug({
            cwd,
            excludes: excludePatterns,
            resolution: 'fast-path',
            resolved: fastPathResolved,
            scan: fsCache.getStats(),
            scope,
          })
        : undefined,
    )
  }

  const { scan: scanResult } = scanForPolicedIntents({
    cwd,
    scanOptions: withFsCache(scanOptions, fsCache),
    coreOptions: options,
    context: projectContext,
  })
  let resolved: ReturnType<typeof resolveSkillUse>
  try {
    resolved = resolveSkillUse(use, scanResult)
  } catch (err) {
    if (err instanceof ResolveSkillUseError) {
      throw new IntentCoreError(err.code, err.message, {
        suggestedSkills: err.suggestedSkills,
      })
    }
    throw err
  }

  return toResolvedIntentSkill(
    cwd,
    use,
    resolved,
    fsCache.getReadFs(),
    options.debug
      ? createLoadedSkillDebug({
          cwd,
          excludes: excludePatterns,
          resolution: 'full-scan',
          resolved,
          scan: scanResult.stats ?? fsCache.getStats(),
          scope,
        })
      : undefined,
  )
}

export function resolveIntentSkill(
  use: string,
  options: IntentCoreOptions = {},
): ResolvedIntentSkill {
  return resolveIntentSkillInCwd(resolveCoreCwd(options), use, options).result
}

export function loadIntentSkill(
  use: string,
  options: IntentCoreOptions = {},
): LoadedIntentSkill {
  const cwd = resolveCoreCwd(options)
  const resolved = resolveIntentSkillInCwd(cwd, use, options)
  const content = rewriteLoadedSkillMarkdownDestinations({
    content: resolved.readFs.readFileSync(resolved.realResolvedPath, 'utf8'),
    cwd,
    packageRoot: resolved.realPackageRoot,
    skillFilePath: resolved.realResolvedPath,
  })

  return {
    ...resolved.result,
    content,
  }
}
