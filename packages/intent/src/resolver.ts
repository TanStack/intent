import { parseSkillUse } from './skill-use.js'
import type { IntentPackage, ScanResult, VersionConflict } from './types.js'

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

  constructor({
    availablePackages = [],
    availableSkills = [],
    code,
    packageName,
    skillName,
    use,
  }: {
    availablePackages?: Array<string>
    availableSkills?: Array<string>
    code: ResolveSkillUseErrorCode
    packageName: string
    skillName: string
    use: string
  }) {
    super(
      formatResolveSkillUseErrorMessage({
        availablePackages,
        availableSkills,
        code,
        packageName,
        skillName,
        use,
      }),
    )
    this.name = 'ResolveSkillUseError'
    this.availablePackages = availablePackages
    this.availableSkills = availableSkills
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

  const skill = pkg.skills.find((candidate) => candidate.name === skillName)

  if (!skill) {
    throw new ResolveSkillUseError({
      availableSkills: pkg.skills.map((candidate) => candidate.name),
      code: 'skill-not-found',
      packageName,
      skillName,
      use,
    })
  }

  const conflict =
    scanResult.conflicts.find(
      (candidate) => candidate.packageName === packageName,
    ) ?? null

  return {
    packageName,
    skillName,
    path: skill.path,
    source: pkg.source,
    version: pkg.version,
    packageRoot: pkg.packageRoot,
    warnings: scanResult.warnings.filter((warning) => {
      const idx = warning.indexOf(packageName)
      if (idx === -1) return false
      const after = warning[idx + packageName.length]
      return after === undefined || /[^a-zA-Z0-9_-]/.test(after)
    }),
    conflict,
  }
}

function formatResolveSkillUseErrorMessage({
  availablePackages,
  availableSkills,
  code,
  packageName,
  skillName,
  use,
}: {
  availablePackages: Array<string>
  availableSkills: Array<string>
  code: ResolveSkillUseErrorCode
  packageName: string
  skillName: string
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
      const available =
        availableSkills.length > 0
          ? ` Available skills: ${availableSkills.join(', ')}.`
          : ''
      return `Cannot resolve skill use "${use}": skill "${skillName}" was not found in package "${packageName}".${available}`
    }
  }
}
