import { scanForIntents } from '../discovery/scanner.js'
import { detectIntentAudience } from '../shared/environment.js'
import { ALLOW_ALL_NOTICE } from '../shared/cli-output.js'
import {
  compileExcludePatterns,
  compileWildcardPattern,
  getConfigDirs,
  getEffectiveExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
  skillNameVariants,
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
  matchesSkill:
    | ((packageName: string, skillName: string) => boolean)
    | undefined
}

export interface CompiledSkillSourcePolicy {
  matchers: Array<SkillSourceMatcher>
  permits: (packageName: string, packageKind?: 'npm' | 'workspace') => boolean
  permitsSkill: (
    packageName: string,
    skillName: string,
    packageKind?: 'npm' | 'workspace',
  ) => boolean
}

function compileSkillSourceMatcher(
  source: ExplicitSkillSource,
): SkillSourceMatcher {
  if (source.kind === 'git') {
    return {
      source,
      matchesPackage: () => false,
      matchesSkill: undefined,
    }
  }

  const matchesName =
    'pattern' in source
      ? compileWildcardPattern(source.pattern)
      : (packageName: string) => source.id === packageName

  const matchesSkillName =
    source.skill === undefined
      ? undefined
      : compileWildcardPattern(source.skill)

  return {
    source,
    matchesPackage: (packageName, packageKind) =>
      (packageKind === undefined || source.kind === packageKind) &&
      matchesName(packageName),
    matchesSkill:
      matchesSkillName === undefined
        ? undefined
        : (packageName, skillName) =>
            skillNameVariants(packageName, skillName).some(matchesSkillName),
  }
}

export function compileSkillSourcePolicy(
  config: SkillSourcesConfig,
): CompiledSkillSourcePolicy {
  switch (config.mode) {
    case 'absent':
    case 'allow-all':
      return { matchers: [], permits: () => true, permitsSkill: () => true }
    case 'empty':
      return { matchers: [], permits: () => false, permitsSkill: () => false }
    case 'explicit': {
      const matchers = config.sources.map(compileSkillSourceMatcher)
      return {
        matchers,
        permits: (packageName, packageKind) =>
          matchers.some((matcher) =>
            matcher.matchesPackage(packageName, packageKind),
          ),
        permitsSkill: (packageName, skillName, packageKind) =>
          matchers.some(
            (matcher) =>
              matcher.matchesPackage(packageName, packageKind) &&
              (matcher.matchesSkill === undefined ||
                matcher.matchesSkill(packageName, skillName)),
          ),
      }
    }
  }
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

export function skillNotListedRefusal(
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
    sourcePolicy: CompiledSkillSourcePolicy
    excludeMatchers: Array<ExcludeMatcher>
  },
): LoadRefusal | null {
  const { sourcePolicy, excludeMatchers } = params
  const { packageName, skillName } = parsed

  if (isPackageExcluded(packageName, excludeMatchers)) {
    return {
      code: 'package-excluded',
      message: `Cannot load skill use "${use}": package "${packageName}" is excluded by Intent configuration.`,
    }
  }

  // Name-only pre-check: kind isn't known until resolution.
  if (!sourcePolicy.permits(packageName)) {
    return packageNotListedRefusal(use, packageName)
  }

  if (!sourcePolicy.permitsSkill(packageName, skillName)) {
    return skillNotListedRefusal(use, packageName, skillName)
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

function formatUnlistedSkillNotice(
  hiddenSources: Array<IntentHiddenSourceSummary>,
  audience: IntentAudience,
): string {
  const uses = [...hiddenSources]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((source) =>
      (source.hiddenSkills ?? []).map((skill) => `${source.name}#${skill}`),
    )

  if (audience === 'agent') {
    return `${uses.length} ${pluralize(uses.length, 'skill', 'skills')} from listed packages ${pluralize(uses.length, 'is', 'are')} hidden because ${pluralize(uses.length, 'it is', 'they are')} not listed in intent.skills. Ask the user to run \`intent list --show-hidden\` outside the agent session to review candidates.`
  }

  return `${uses.length} ${pluralize(uses.length, 'skill', 'skills')} from listed packages ${pluralize(uses.length, 'is', 'are')} not listed in intent.skills: ${uses.join(', ')}. Add to opt in.`
}

export interface SourcePolicyResult {
  hiddenSourceCount: number
  hiddenSources: Array<IntentHiddenSourceSummary>
  packages: Array<IntentPackage>
  notices: Array<string>
}

export function scanForConfiguredIntents({
  config,
  exclude,
  root,
}: {
  config: SkillSourcesConfig
  exclude: Array<string>
  root: string
}): {
  discovered: Array<IntentPackage>
  policy: SourcePolicyResult
} {
  const scan = scanForIntents(root, { scope: 'local' })
  const discovered = scan.packages.filter((pkg) => pkg.source === 'local')
  return {
    discovered,
    policy: applySourcePolicy(
      { packages: discovered },
      { config, excludeMatchers: compileExcludePatterns(exclude) },
    ),
  }
}

export function applySourcePolicy(
  scanResult: { packages: Array<IntentPackage> },
  options: SourcePolicyOptions,
): SourcePolicyResult {
  const { config, excludeMatchers } = options
  const audience = options.audience ?? 'human'
  const sourcePolicy = compileSkillSourcePolicy(config)
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

    if (!sourcePolicy.permits(pkg.name, pkg.kind)) {
      if (config.mode === 'explicit') {
        hiddenSources.push({ name: pkg.name, skillCount: pkg.skills.length })
      }
      continue
    }

    const skills: Array<IntentPackage['skills'][number]> = []
    const hiddenSkills: Array<string> = []
    for (const skill of pkg.skills) {
      if (isSkillExcluded(pkg.name, skill.name, excludeMatchers)) continue
      if (!sourcePolicy.permitsSkill(pkg.name, skill.name, pkg.kind)) {
        hiddenSkills.push(skill.name)
        continue
      }
      skills.push(skill)
    }
    if (config.mode === 'explicit' && hiddenSkills.length > 0) {
      hiddenSources.push({
        name: pkg.name,
        skillCount: hiddenSkills.length,
        hiddenSkills,
      })
    }
    packages.push(
      skills.length === pkg.skills.length ? pkg : { ...pkg, skills },
    )
  }

  const unlistedSources = hiddenSources.filter(
    (source) => source.hiddenSkills === undefined,
  )
  const partiallyHidden = hiddenSources.filter(
    (source) => source.hiddenSkills !== undefined,
  )
  if (unlistedSources.length > 0) {
    emit(formatUnlistedNotice(unlistedSources, audience))
  }
  if (partiallyHidden.length > 0) {
    emit(formatUnlistedSkillNotice(partiallyHidden, audience))
  }

  if (config.mode === 'explicit') {
    for (const matcher of sourcePolicy.matchers) {
      const { matchesSkill } = matcher
      const notDiscovered = !scanResult.packages.some(
        (pkg) =>
          matcher.matchesPackage(pkg.name, pkg.kind) &&
          (matchesSkill === undefined ||
            pkg.skills.some((skill) => matchesSkill(pkg.name, skill.name))),
      )
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
  excludePatterns: Array<string>
  droppedNames: Array<string>
}

export function scanForPolicedIntents(params: {
  cwd: string
  scanOptions: ScanOptions
  coreOptions: IntentCoreOptions
  context?: ProjectContext
  config?: SkillSourcesConfig
}): PolicedScan {
  const { cwd, scanOptions, coreOptions } = params
  const context = params.context ?? resolveProjectContext({ cwd })
  const audience = detectIntentAudience(coreOptions.audience)

  const scanResult = scanForIntents(cwd, scanOptions)
  const config = params.config ?? readSkillSourcesConfig(cwd, context)
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
    excludePatterns,
    droppedNames,
  }
}
