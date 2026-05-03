import { warningMentionsPackage } from './core/excludes.js'
import { parseSkillUse } from './skill-use.js'
import type {
  IntentPackage,
  ScanResult,
  SkillEntry,
  VersionConflict,
} from './types.js'

export interface ResolveSkillResult {
  packageName: string
  skillName: string
  path: string
  source: IntentPackage['source']
  version: string
  packageRoot: string
  warnings: Array<string>
  conflict: VersionConflict | null
}

export type ResolveSkillUseErrorCode = 'package-not-found' | 'skill-not-found'

export class ResolveSkillUseError extends Error {
  readonly code: ResolveSkillUseErrorCode
  readonly use: string
  readonly packageName: string
  readonly skillName: string
  readonly availablePackages: Array<string>
  readonly availableSkills: Array<string>
  readonly suggestedSkills: Array<string>

  constructor({
    availablePackages = [],
    availableSkills = [],
    code,
    packageName,
    skillName,
    suggestedSkills = [],
    use,
  }: {
    availablePackages?: Array<string>
    availableSkills?: Array<string>
    code: ResolveSkillUseErrorCode
    packageName: string
    skillName: string
    suggestedSkills?: Array<string>
    use: string
  }) {
    super(
      formatResolveSkillUseErrorMessage({
        availablePackages,
        availableSkills,
        code,
        packageName,
        skillName,
        suggestedSkills,
        use,
      }),
    )
    this.name = 'ResolveSkillUseError'
    this.availablePackages = availablePackages
    this.availableSkills = availableSkills
    this.suggestedSkills = suggestedSkills
    this.code = code
    this.packageName = packageName
    this.skillName = skillName
    this.use = use
  }
}

export function isResolveSkillUseError(
  error: unknown,
): error is ResolveSkillUseError {
  return error instanceof ResolveSkillUseError
}

export interface ResolveSkillEntryResult {
  skill: SkillEntry | null
  suggestedSkills: Array<string>
}

function getPackageShortName(packageName: string): string {
  return packageName.split('/').pop() ?? packageName
}

function getPackagePrefixedSkillAlias(
  packageName: string,
  skillName: string,
): string | null {
  const prefix = `${getPackageShortName(packageName)}/`
  return skillName.startsWith(prefix) ? skillName.slice(prefix.length) : null
}

function getSuggestedSkills(
  packageName: string,
  skillName: string,
  skills: Array<SkillEntry>,
): Array<string> {
  const lowerSkillName = skillName.toLowerCase()
  const suggestions: Array<string> = []
  const seen = new Set<string>()

  for (const skill of skills) {
    const alias = getPackagePrefixedSkillAlias(packageName, skill.name)
    const lowerName = skill.name.toLowerCase()
    const lowerAlias = alias?.toLowerCase()
    const matches =
      lowerAlias === lowerSkillName ||
      lowerName.includes(lowerSkillName) ||
      lowerAlias?.includes(lowerSkillName)

    if (!matches || seen.has(skill.name)) continue

    seen.add(skill.name)
    suggestions.push(skill.name)
  }

  return suggestions.slice(0, 3)
}

export function resolveSkillEntry(
  packageName: string,
  skillName: string,
  skills: Array<SkillEntry>,
): ResolveSkillEntryResult {
  const exact = skills.find((candidate) => candidate.name === skillName)
  if (exact) {
    return { skill: exact, suggestedSkills: [] }
  }

  const aliasMatches = skills.filter(
    (candidate) =>
      getPackagePrefixedSkillAlias(packageName, candidate.name) === skillName,
  )

  if (aliasMatches.length === 1) {
    return { skill: aliasMatches[0]!, suggestedSkills: [] }
  }

  return {
    skill: null,
    suggestedSkills: getSuggestedSkills(packageName, skillName, skills),
  }
}

export function resolveSkillUse(
  use: string,
  scanResult: ScanResult,
): ResolveSkillResult {
  const { packageName, skillName } = parseSkillUse(use)
  const packages = scanResult.packages.filter((pkg) => pkg.name === packageName)
  const pkg =
    packages.find((candidate) => candidate.source === 'local') ?? packages[0]

  if (!pkg) {
    throw new ResolveSkillUseError({
      availablePackages: scanResult.packages.map((candidate) => candidate.name),
      code: 'package-not-found',
      packageName,
      skillName,
      use,
    })
  }

  const resolvedSkill = resolveSkillEntry(packageName, skillName, pkg.skills)
  const skill = resolvedSkill.skill

  if (!skill) {
    throw new ResolveSkillUseError({
      availableSkills: pkg.skills.map((candidate) => candidate.name),
      code: 'skill-not-found',
      packageName,
      skillName,
      suggestedSkills: resolvedSkill.suggestedSkills,
      use,
    })
  }

  const conflict =
    scanResult.conflicts.find(
      (candidate) => candidate.packageName === packageName,
    ) ?? null

  return {
    packageName,
    skillName: skill.name,
    path: skill.path,
    source: pkg.source,
    version: pkg.version,
    packageRoot: pkg.packageRoot,
    warnings: scanResult.warnings.filter((warning) =>
      warningMentionsPackage(warning, packageName),
    ),
    conflict,
  }
}

function formatResolveSkillUseErrorMessage({
  availablePackages,
  availableSkills,
  code,
  packageName,
  skillName,
  suggestedSkills,
  use,
}: {
  availablePackages: Array<string>
  availableSkills: Array<string>
  code: ResolveSkillUseErrorCode
  packageName: string
  skillName: string
  suggestedSkills: Array<string>
  use: string
}): string {
  switch (code) {
    case 'package-not-found': {
      const available =
        availablePackages.length > 0
          ? ` Available packages: ${availablePackages.join(', ')}.`
          : ''
      return `Cannot resolve skill use "${use}": package "${packageName}" was not found.${available}`
    }
    case 'skill-not-found': {
      const suggestions =
        suggestedSkills.length > 0
          ? ` Did you mean ${formatSkillSuggestions(packageName, suggestedSkills)}?`
          : ''
      const available =
        availableSkills.length > 0
          ? ` Available skills: ${availableSkills.join(', ')}.`
          : ''
      return `Cannot resolve skill use "${use}": skill "${skillName}" was not found in package "${packageName}".${suggestions}${available}`
    }
  }
}

function formatSkillSuggestions(
  packageName: string,
  skillNames: Array<string>,
): string {
  const uses = skillNames.map((skillName) => `${packageName}#${skillName}`)

  if (uses.length <= 2) {
    return uses.join(' or ')
  }

  return `${uses.slice(0, -1).join(', ')}, or ${uses.at(-1)}`
}
