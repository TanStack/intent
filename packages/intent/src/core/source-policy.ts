import { scanForIntents } from '../scanner.js'
import {
  compileExcludePatterns,
  getConfigDirs,
  getEffectiveExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
  warningMentionsPackage,
} from './excludes.js'
import { readPackageJson } from './package-json.js'
import { parseSkillSources } from './skill-sources.js'
import { resolveProjectContext } from './project-context.js'
import type { ExcludeMatcher } from './excludes.js'
import type { ProjectContext } from './project-context.js'
import type { SkillSourcesConfig } from './skill-sources.js'
import type { IntentCoreOptions } from './types.js'
import type { IntentPackage, ScanOptions, ScanResult } from '../types.js'

export const ALLOW_ALL_WARNING =
  'All skill sources allowed (intent.skills: ["*"]) — unvetted skills may be surfaced into agent guidance.'

export const MIGRATION_WARNING =
  'intent.skills is not set — all discovered skill sources are surfaced. A future version will require an explicit intent.skills allowlist; add one to opt in to specific sources.'

export const EMPTY_NOTE =
  'intent.skills is empty — no skill sources are permitted.'

export interface SourcePolicyOptions {
  config: SkillSourcesConfig
  excludeMatchers: Array<ExcludeMatcher>
  seen?: Set<string>
}

export interface SourcePolicyResult {
  packages: Array<IntentPackage>
  warnings: Array<string>
}

export function applySourcePolicy(
  scanResult: { packages: Array<IntentPackage> },
  options: SourcePolicyOptions,
): SourcePolicyResult {
  const { config, excludeMatchers } = options
  const seen = options.seen ?? new Set<string>()
  const warnings: Array<string> = []

  const emit = (warning: string): void => {
    if (seen.has(warning)) return
    seen.add(warning)
    warnings.push(warning)
  }

  const permitAll = config.mode === 'absent' || config.mode === 'allow-all'
  const allowedIds =
    config.mode === 'explicit'
      ? new Set(config.sources.map((source) => source.id))
      : null
  const discoveredNames = new Set(scanResult.packages.map((pkg) => pkg.name))

  const packages: Array<IntentPackage> = []

  for (const pkg of scanResult.packages) {
    if (isPackageExcluded(pkg.name, excludeMatchers)) continue

    const allowed = permitAll || (allowedIds?.has(pkg.name) ?? false)
    if (!allowed) {
      if (config.mode === 'explicit') {
        emit(
          `Found skills in "${pkg.name}" but it is not listed in intent.skills — add it to opt in.`,
        )
      }
      continue
    }

    const skills = pkg.skills.filter(
      (skill) => !isSkillExcluded(pkg.name, skill.name, excludeMatchers),
    )
    packages.push(
      skills.length === pkg.skills.length ? pkg : { ...pkg, skills },
    )
  }

  if (config.mode === 'explicit') {
    for (const source of config.sources) {
      if (!discoveredNames.has(source.id)) {
        emit(
          `"${source.raw}" is declared in intent.skills but was not discovered.`,
        )
      }
    }
  }

  if (config.mode === 'absent') emit(MIGRATION_WARNING)
  else if (config.mode === 'allow-all') emit(ALLOW_ALL_WARNING)
  else if (config.mode === 'empty') emit(EMPTY_NOTE)

  return { packages, warnings }
}

// A null/undefined intent.skills is treated as not-declared so it cannot
// shadow a stricter parent allowlist.
export function readSkillSourcesConfig(
  cwd: string,
  context: ProjectContext = resolveProjectContext({ cwd }),
): SkillSourcesConfig {
  for (const dir of getConfigDirs(cwd, context)) {
    const intent = readPackageJson(dir)?.intent
    if (!intent || typeof intent !== 'object') continue

    if ('skills' in intent) {
      const skills = (intent as Record<string, unknown>).skills
      if (skills === null || skills === undefined) continue
      return parseSkillSources(skills)
    }
  }

  return { mode: 'absent' }
}

export interface PolicedScan {
  scan: ScanResult
  excludePatterns: Array<string>
}

export function scanForPolicedIntents(params: {
  cwd: string
  scanOptions: ScanOptions
  coreOptions: IntentCoreOptions
  context?: ProjectContext
  seen?: Set<string>
}): PolicedScan {
  const { cwd, scanOptions, coreOptions, seen } = params
  const context = params.context ?? resolveProjectContext({ cwd })

  const scanResult = scanForIntents(cwd, scanOptions)
  const config = readSkillSourcesConfig(cwd, context)
  const excludePatterns = getEffectiveExcludePatterns(coreOptions, context)
  const excludeMatchers = compileExcludePatterns(excludePatterns)

  const policy = applySourcePolicy(scanResult, {
    config,
    excludeMatchers,
    seen,
  })

  const survivingNames = new Set(policy.packages.map((pkg) => pkg.name))
  const droppedNames = scanResult.packages
    .map((pkg) => pkg.name)
    .filter((name) => !survivingNames.has(name))

  return {
    scan: {
      ...scanResult,
      packages: policy.packages,
      warnings: [
        ...scanResult.warnings.filter(
          (warning) =>
            !droppedNames.some((name) => warningMentionsPackage(warning, name)),
        ),
        ...policy.warnings,
      ],
      conflicts: scanResult.conflicts.filter((conflict) =>
        survivingNames.has(conflict.packageName),
      ),
    },
    excludePatterns,
  }
}
