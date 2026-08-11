import { scanForIntents } from '../discovery/scanner.js'
import { detectIntentAudience } from '../shared/environment.js'
import { ALLOW_ALL_NOTICE } from '../shared/cli-output.js'
import { resolveSkillEntry } from '../skills/resolver.js'
import {
  compileExcludePatterns,
  compileWildcardPattern,
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
import type {
  IntentPackage,
  ScanOptions,
  ScanResult,
  SkillEntry,
} from '../shared/types.js'
import type { ExcludeMatcher } from './excludes.js'
import type { ProjectContext } from './project-context.js'
import type { SkillSourcesConfig } from './skill-sources.js'
import type {
  IntentAudience,
  IntentCoreOptions,
  IntentHiddenSourceSummary,
} from './types.js'

export { ALLOW_ALL_NOTICE }

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
  | 'skill-not-listed'

export interface LoadRefusal {
  code: LoadRefusalCode
  message: string
}

type ExplicitSkillSource = Extract<
  SkillSourcesConfig,
  { mode: 'explicit' }
>['sources'][number]

interface SkillSourceMatcher {
  source: ExplicitSkillSource
  matchesPackage: (
    packageName: string,
    packageKind?: 'npm' | 'workspace',
  ) => boolean
  selectorSkill?: string
}

function compileSkillSourceMatcher(
  source: ExplicitSkillSource,
): SkillSourceMatcher {
  if (source.kind === 'git') {
    return { source, matchesPackage: () => false }
  }

  const matchesName =
    'pattern' in source
      ? compileWildcardPattern(source.pattern)
      : (packageName: string) => source.id === packageName

  return {
    source,
    matchesPackage: (packageName, packageKind) =>
      (packageKind === undefined || source.kind === packageKind) &&
      matchesName(packageName),
    selectorSkill:
      'id' in source && source.skill !== undefined ? source.skill : undefined,
  }
}

export interface CompiledSkillSourcePolicy {
  permitsPackage: (
    packageName: string,
    packageKind?: 'npm' | 'workspace',
  ) => boolean
  permitsSkill: (
    packageName: string,
    skillName: string,
    packageKind: 'npm' | 'workspace' | undefined,
    availableSkills: Array<SkillEntry>,
  ) => boolean
}

interface CompiledSkillSourcePolicyState {
  matchers: Array<SkillSourceMatcher>
  policy: CompiledSkillSourcePolicy
}

function compileSkillSourcePolicyState(
  config: SkillSourcesConfig,
): CompiledSkillSourcePolicyState {
  switch (config.mode) {
    case 'absent':
    case 'allow-all':
      return {
        matchers: [],
        policy: { permitsPackage: () => true, permitsSkill: () => true },
      }
    case 'empty':
      return {
        matchers: [],
        policy: { permitsPackage: () => false, permitsSkill: () => false },
      }
    case 'explicit': {
      const matchers = config.sources.map(compileSkillSourceMatcher)
      return {
        matchers,
        policy: {
          permitsPackage: (packageName, packageKind) =>
            matchers.some((matcher) =>
              matcher.matchesPackage(packageName, packageKind),
            ),
          permitsSkill: (
            packageName,
            skillName,
            packageKind,
            availableSkills,
          ) =>
            matchers.some((matcher) => {
              if (!matcher.matchesPackage(packageName, packageKind)) {
                return false
              }
              if (matcher.selectorSkill === undefined) return true
              return (
                resolveSkillEntry(
                  packageName,
                  matcher.selectorSkill,
                  availableSkills,
                ).skill?.name === skillName
              )
            }),
        },
      }
    }
  }
}

export function compileSkillSourcePolicy(
  config: SkillSourcesConfig,
): CompiledSkillSourcePolicy {
  return compileSkillSourcePolicyState(config).policy
}

export function packageNotListedRefusal(
  use: string,
  packageName: string,
): LoadRefusal {
  return {
    code: 'package-not-listed',
    message: `Cannot load skill use "${use}": package "${packageName}" is not listed in intent.skills.`,
  }
}

function skillNotListedRefusal(
  use: string,
  packageName: string,
  skillName: string,
): LoadRefusal {
  return {
    code: 'skill-not-listed',
    message: `Cannot load skill use "${use}": skill "${packageName}#${skillName}" is not listed in intent.skills.`,
  }
}

export function checkLoadAllowed(
  use: string,
  parsed: SkillUse,
  params: {
    policy: CompiledSkillSourcePolicy
    excludeMatchers: Array<ExcludeMatcher>
    packageKind?: 'npm' | 'workspace'
    availableSkills?: Array<SkillEntry>
  },
): LoadRefusal | null {
  const { policy, excludeMatchers, packageKind, availableSkills } = params
  const { packageName, skillName } = parsed

  if (isPackageExcluded(packageName, excludeMatchers)) {
    return {
      code: 'package-excluded',
      message: `Cannot load skill use "${use}": package "${packageName}" is excluded by Intent configuration.`,
    }
  }

  if (!policy.permitsPackage(packageName, packageKind)) {
    return packageNotListedRefusal(use, packageName)
  }

  if (isSkillExcluded(packageName, skillName, excludeMatchers)) {
    return {
      code: 'skill-excluded',
      message: `Cannot load skill use "${use}": skill "${packageName}#${skillName}" is excluded by Intent configuration.`,
    }
  }

  if (
    availableSkills !== undefined &&
    !policy.permitsSkill(packageName, skillName, packageKind, availableSkills)
  ) {
    return skillNotListedRefusal(use, packageName, skillName)
  }

  return null
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function formatUnlistedNotice(
  hiddenSources: Array<IntentHiddenSourceSummary>,
  audience: IntentAudience,
  hasWithheldSkills: boolean,
): string {
  const sorted = [...hiddenSources].sort((a, b) => a.name.localeCompare(b.name))
  const sourceCount = sorted.length
  const skillCount = sorted.reduce((sum, source) => sum + source.skillCount, 0)

  if (audience === 'agent') {
    if (hasWithheldSkills) {
      return `${sourceCount} discovered ${pluralize(sourceCount, 'skill source', 'skill sources')} ${pluralize(sourceCount, 'has', 'have')} ${skillCount} ${pluralize(skillCount, 'skill', 'skills')} that ${pluralize(skillCount, 'is', 'are')} not listed in intent.skills. Ask the user to run \`intent list --show-hidden\` outside the agent session to review candidates.`
    }
    return `${sourceCount} discovered ${pluralize(sourceCount, 'skill source', 'skill sources')} with ${skillCount} ${pluralize(skillCount, 'skill', 'skills')} ${pluralize(sourceCount, 'is', 'are')} hidden because ${pluralize(sourceCount, 'it is', 'they are')} not listed in intent.skills. Ask the user to run \`intent list --show-hidden\` outside the agent session to review candidates.`
  }

  if (hasWithheldSkills) {
    return `${sourceCount} discovered ${pluralize(sourceCount, 'skill source', 'skill sources')} ${pluralize(sourceCount, 'has', 'have')} ${skillCount} ${pluralize(skillCount, 'skill', 'skills')} not listed in intent.skills: ${sorted.map((source) => source.name).join(', ')}. Add to opt in.`
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
  const { matchers, policy: sourcePolicy } =
    compileSkillSourcePolicyState(config)
  const seen = new Set<string>()
  const notices: Array<string> = []

  const emit = (notice: string): void => {
    if (seen.has(notice)) return
    seen.add(notice)
    notices.push(notice)
  }

  const packages: Array<IntentPackage> = []
  const hiddenSources: Array<IntentHiddenSourceSummary> = []
  let hasWithheldSkills = false

  for (const pkg of scanResult.packages) {
    if (isPackageExcluded(pkg.name, excludeMatchers)) continue

    if (!sourcePolicy.permitsPackage(pkg.name, pkg.kind)) {
      if (config.mode === 'explicit') {
        hiddenSources.push({ name: pkg.name, skillCount: pkg.skills.length })
      }
      continue
    }

    let withheldSkillCount = 0
    const skills = pkg.skills.filter((skill) => {
      if (isSkillExcluded(pkg.name, skill.name, excludeMatchers)) return false
      if (
        !sourcePolicy.permitsSkill(pkg.name, skill.name, pkg.kind, pkg.skills)
      ) {
        withheldSkillCount += 1
        return false
      }
      return true
    })
    if (config.mode === 'explicit' && withheldSkillCount > 0) {
      hiddenSources.push({ name: pkg.name, skillCount: withheldSkillCount })
      hasWithheldSkills = true
    }
    packages.push(
      skills.length === pkg.skills.length ? pkg : { ...pkg, skills },
    )
  }

  if (hiddenSources.length > 0) {
    emit(formatUnlistedNotice(hiddenSources, audience, hasWithheldSkills))
  }

  if (config.mode === 'explicit') {
    for (const matcher of matchers) {
      const notDiscovered = !scanResult.packages.some((pkg) => {
        if (!matcher.matchesPackage(pkg.name, pkg.kind)) return false
        if (matcher.selectorSkill === undefined) return true
        return (
          resolveSkillEntry(pkg.name, matcher.selectorSkill, pkg.skills)
            .skill !== null
        )
      })
      if (notDiscovered) {
        emit(
          `"${matcher.source.raw}" is declared in intent.skills but was not discovered.`,
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
  resolutionPackages: Array<IntentPackage>
  excludePatterns: Array<string>
  droppedNames: Array<string>
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

  // Name-only Sets, correct because the scanner guarantees at most one
  // package per name (createPackageRegistrar dedups before this runs).
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
    resolutionPackages: scanResult.packages,
    excludePatterns,
    droppedNames,
  }
}
