import { scanForIntents } from '../discovery/scanner.js'
import { detectIntentAudience } from '../shared/environment.js'
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
import type { SkillUse } from '../skills/use.js'
import type { IntentPackage, ScanOptions, ScanResult } from '../shared/types.js'
import type { ExcludeMatcher } from './excludes.js'
import type { ProjectContext } from './project-context.js'
import type { SkillSourcesConfig } from './skill-sources.js'
import type {
  IntentAudience,
  IntentCoreOptions,
  IntentHiddenSourceSummary,
} from './types.js'

export const ALLOW_ALL_NOTICE =
  'All skill sources allowed (intent.skills: ["*"]) — unvetted skills may be surfaced into agent guidance.'

export const MIGRATION_NOTICE =
  'intent.skills is not set — all discovered skill sources are surfaced. A future version will require an explicit intent.skills allowlist; add one to opt in to specific sources.'

export const EMPTY_NOTE =
  'intent.skills is empty — no skill sources are permitted.'

export interface SourcePolicyOptions {
  audience?: IntentAudience
  config: SkillSourcesConfig
  excludeMatchers: Array<ExcludeMatcher>
}

type LoadRefusalCode =
  | 'package-excluded'
  | 'package-not-listed'
  | 'skill-excluded'

export interface LoadRefusal {
  code: LoadRefusalCode
  message: string
}

function isSourcePermitted(
  config: SkillSourcesConfig,
  packageName: string,
): boolean {
  switch (config.mode) {
    case 'absent':
    case 'allow-all':
      return true
    case 'empty':
      return false
    case 'explicit':
      return config.sources.some((source) => source.id === packageName)
  }
}

export function checkLoadAllowed(
  use: string,
  parsed: SkillUse,
  params: {
    config: SkillSourcesConfig
    excludeMatchers: Array<ExcludeMatcher>
  },
): LoadRefusal | null {
  const { config, excludeMatchers } = params
  const { packageName, skillName } = parsed

  if (isPackageExcluded(packageName, excludeMatchers)) {
    return {
      code: 'package-excluded',
      message: `Cannot load skill use "${use}": package "${packageName}" is excluded by Intent configuration.`,
    }
  }

  if (!isSourcePermitted(config, packageName)) {
    return {
      code: 'package-not-listed',
      message: `Cannot load skill use "${use}": package "${packageName}" is not listed in intent.skills.`,
    }
  }

  if (isSkillExcluded(packageName, skillName, excludeMatchers)) {
    return {
      code: 'skill-excluded',
      message: `Cannot load skill use "${use}": skill "${packageName}#${skillName}" is excluded by Intent configuration.`,
    }
  }

  return null
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function formatUnlistedNotice(
  hiddenSources: Array<IntentHiddenSourceSummary>,
  audience: IntentAudience,
): string {
  const sorted = [...hiddenSources].sort((a, b) => a.name.localeCompare(b.name))
  const sourceCount = sorted.length
  const skillCount = sorted.reduce((sum, source) => sum + source.skillCount, 0)

  if (audience === 'agent') {
    return `${sourceCount} discovered ${pluralize(sourceCount, 'skill source', 'skill sources')} with ${skillCount} ${pluralize(skillCount, 'skill', 'skills')} ${pluralize(sourceCount, 'is', 'are')} hidden because ${pluralize(sourceCount, 'it is', 'they are')} not listed in intent.skills. Ask the user to run \`intent list --show-hidden\` outside the agent session to review candidates.`
  }

  const noun = sourceCount === 1 ? 'package ships' : 'packages ship'
  return `${sourceCount} discovered ${noun} skills but ${sourceCount === 1 ? 'is' : 'are'} not listed in intent.skills: ${sorted.map((source) => source.name).join(', ')}. Add to opt in.`
}

export interface SourcePolicyResult {
  hiddenSourceCount: number
  hiddenSources: Array<IntentHiddenSourceSummary>
  packages: Array<IntentPackage>
  notices: Array<string>
}

export function applySourcePolicy(
  scanResult: { packages: Array<IntentPackage> },
  options: SourcePolicyOptions,
): SourcePolicyResult {
  const { config, excludeMatchers } = options
  const audience = options.audience ?? 'human'
  const seen = new Set<string>()
  const notices: Array<string> = []

  const emit = (notice: string): void => {
    if (seen.has(notice)) return
    seen.add(notice)
    notices.push(notice)
  }

  const packages: Array<IntentPackage> = []
  const hiddenSources: Array<IntentHiddenSourceSummary> = []

  for (const pkg of scanResult.packages) {
    if (isPackageExcluded(pkg.name, excludeMatchers)) continue

    if (!isSourcePermitted(config, pkg.name)) {
      if (config.mode === 'explicit') {
        hiddenSources.push({ name: pkg.name, skillCount: pkg.skills.length })
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

  if (hiddenSources.length > 0) {
    emit(formatUnlistedNotice(hiddenSources, audience))
  }

  if (config.mode === 'explicit') {
    const discoveredNames = new Set(scanResult.packages.map((pkg) => pkg.name))
    for (const source of config.sources) {
      if (!discoveredNames.has(source.id)) {
        emit(
          `"${source.raw}" is declared in intent.skills but was not discovered.`,
        )
      }
    }
  }

  if (config.mode === 'absent') emit(MIGRATION_NOTICE)
  else if (config.mode === 'allow-all') emit(ALLOW_ALL_NOTICE)
  else if (config.mode === 'empty') emit(EMPTY_NOTE)

  return {
    hiddenSourceCount: hiddenSources.length,
    hiddenSources,
    packages,
    notices,
  }
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
  hiddenSourceCount: number
  hiddenSources: Array<IntentHiddenSourceSummary>
  scan: ScanResult
  excludePatterns: Array<string>
}

export function scanForPolicedIntents(params: {
  cwd: string
  scanOptions: ScanOptions
  coreOptions: IntentCoreOptions
  context?: ProjectContext
}): PolicedScan {
  const { cwd, scanOptions, coreOptions } = params
  const context = params.context ?? resolveProjectContext({ cwd })
  const audience = detectIntentAudience(coreOptions.audience)

  const scanResult = scanForIntents(cwd, scanOptions)
  const config = readSkillSourcesConfig(cwd, context)
  const excludePatterns = getEffectiveExcludePatterns(coreOptions, context)
  const excludeMatchers = compileExcludePatterns(excludePatterns)

  const policy = applySourcePolicy(scanResult, {
    audience,
    config,
    excludeMatchers,
  })

  const survivingNames = new Set(policy.packages.map((pkg) => pkg.name))
  const droppedNames = scanResult.packages
    .map((pkg) => pkg.name)
    .filter((name) => !survivingNames.has(name))

  return {
    hiddenSourceCount: policy.hiddenSourceCount,
    hiddenSources: audience === 'agent' ? [] : policy.hiddenSources,
    scan: {
      ...scanResult,
      packages: policy.packages,
      warnings: scanResult.warnings.filter(
        (warning) =>
          !droppedNames.some((name) => warningMentionsPackage(warning, name)),
      ),
      notices: policy.notices,
      conflicts: scanResult.conflicts.filter((conflict) =>
        survivingNames.has(conflict.packageName),
      ),
    },
    excludePatterns,
  }
}
