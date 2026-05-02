import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  getEffectiveExcludePatterns,
  isPackageExcluded,
  warningMentionsPackage,
} from './core/excludes.js'
import { rewriteLoadedSkillMarkdownDestinations } from './core/markdown.js'
import { resolveSkillUseFastPath } from './core/load-resolution.js'
import {
  ResolveSkillUseError,
  resolveSkillUse,
  type ResolveSkillResult,
} from './resolver.js'
import { formatSkillUse, parseSkillUse } from './skill-use.js'
import { scanForIntents } from './scanner.js'
import type { ScanOptions, ScanScope } from './types.js'
import type {
  IntentCoreErrorCode,
  IntentCoreOptions,
  IntentSkillList,
  IntentSkillSummary,
  LoadedIntentSkillDebug,
  LoadedIntentSkill,
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

  constructor(code: IntentCoreErrorCode, message: string) {
    super(message)
    this.name = 'IntentCoreError'
    this.code = code
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

function withCwd<T>(cwd: string | undefined, callback: () => T): T {
  if (!cwd) return callback()

  const originalCwd = process.cwd()
  process.chdir(cwd)
  try {
    return callback()
  } finally {
    process.chdir(originalCwd)
  }
}

export function listIntentSkills(
  options: IntentCoreOptions = {},
): IntentSkillList {
  return withCwd(options.cwd, () => {
    const scanOptions = toScanOptions(options)
    const scanResult = scanForIntents(undefined, scanOptions)
    const excludePatterns = getEffectiveExcludePatterns(options)
    const excludedPackages = scanResult.packages
      .filter((pkg) => isPackageExcluded(pkg.name, excludePatterns))
      .map((pkg) => pkg.name)
    const packages = scanResult.packages.filter(
      (pkg) => !isPackageExcluded(pkg.name, excludePatterns),
    )
    const skills = packages.flatMap((pkg) =>
      pkg.skills.map((skill): IntentSkillSummary => {
        return {
          use: formatSkillUse(pkg.name, skill.name),
          packageName: pkg.name,
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
      skills,
      packages: packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        source: pkg.source,
        skillCount: pkg.skills.length,
      })),
      warnings: scanResult.warnings.filter(
        (warning) =>
          !excludedPackages.some((packageName) =>
            warningMentionsPackage(warning, packageName),
          ),
      ),
      conflicts: scanResult.conflicts.filter(
        (conflict) => !isPackageExcluded(conflict.packageName, excludePatterns),
      ),
    }

    if (options.debug) {
      result.debug = {
        cwd: process.cwd(),
        scope: getScanScope(scanOptions),
        excludes: excludePatterns,
        packageCount: result.packages.length,
        skillCount: result.skills.length,
        warningCount: result.warnings.length,
        conflictCount: result.conflicts.length,
      }
    }

    return result
  })
}

function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path)
}

function isPathInsidePackageRoot(path: string, packageRoot: string): boolean {
  const relativePath = relative(
    resolveFromCwd(packageRoot),
    resolveFromCwd(path),
  )
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function toResolvedIntentSkill(
  use: string,
  resolved: ResolveSkillResult,
  debug?: LoadedIntentSkillDebug,
): ResolvedIntentSkill {
  const resolvedPath = resolveFromCwd(resolved.path)

  if (!isPathInsidePackageRoot(resolved.path, resolved.packageRoot)) {
    throw new IntentCoreError(
      'skill-path-outside-package',
      `Resolved skill path for "${use}" is outside package root: ${resolved.path}`,
    )
  }

  if (!existsSync(resolvedPath)) {
    throw new IntentCoreError(
      'skill-file-not-found',
      `Resolved skill file was not found: ${resolved.path}`,
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

  return result
}

function createLoadedSkillDebug({
  excludes,
  resolution,
  resolved,
  scope,
}: {
  excludes: Array<string>
  resolution: LoadedIntentSkillDebug['resolution']
  resolved: ResolveSkillResult
  scope: ScanScope
}): LoadedIntentSkillDebug {
  return {
    cwd: process.cwd(),
    scope,
    resolution,
    excludes,
    packageName: resolved.packageName,
    skillName: resolved.skillName,
    version: resolved.version,
    source: resolved.source,
    path: resolved.path,
    warningCount: resolved.warnings.length,
  }
}

export function resolveIntentSkill(
  use: string,
  options: IntentCoreOptions = {},
): ResolvedIntentSkill {
  return withCwd(options.cwd, () => {
    let parsedUse: ReturnType<typeof parseSkillUse>
    try {
      parsedUse = parseSkillUse(use)
    } catch (err) {
      throw new IntentCoreError(
        'invalid-skill-use',
        err instanceof Error ? err.message : String(err),
      )
    }

    const excludePatterns = getEffectiveExcludePatterns(options)

    if (isPackageExcluded(parsedUse.packageName, excludePatterns)) {
      throw new IntentCoreError(
        'package-excluded',
        `Cannot load skill use "${use}": package "${parsedUse.packageName}" is excluded by Intent configuration.`,
      )
    }

    const scanOptions = toScanOptions(options)
    const scope = getScanScope(scanOptions)
    const fastPathResolved = resolveSkillUseFastPath(parsedUse, options)
    if (fastPathResolved) {
      return toResolvedIntentSkill(
        use,
        fastPathResolved,
        options.debug
          ? createLoadedSkillDebug({
              excludes: excludePatterns,
              resolution: 'fast-path',
              resolved: fastPathResolved,
              scope,
            })
          : undefined,
      )
    }

    const scanResult = scanForIntents(undefined, scanOptions)
    let resolved: ReturnType<typeof resolveSkillUse>
    try {
      resolved = resolveSkillUse(use, scanResult)
    } catch (err) {
      if (err instanceof ResolveSkillUseError) {
        throw new IntentCoreError(err.code, err.message)
      }
      throw err
    }

    return toResolvedIntentSkill(
      use,
      resolved,
      options.debug
        ? createLoadedSkillDebug({
            excludes: excludePatterns,
            resolution: 'full-scan',
            resolved,
            scope,
          })
        : undefined,
    )
  })
}

export function loadIntentSkill(
  use: string,
  options: IntentCoreOptions = {},
): LoadedIntentSkill {
  const resolved = resolveIntentSkill(use, options)

  return withCwd(options.cwd, () => {
    const resolvedPath = resolveFromCwd(resolved.path)
    const content = rewriteLoadedSkillMarkdownDestinations({
      content: readFileSync(resolvedPath, 'utf8'),
      cwd: process.cwd(),
      packageRoot: resolved.packageRoot,
      skillFilePath: resolvedPath,
    })

    return {
      ...resolved,
      content,
    }
  })
}
