export interface SkillUse {
  packageName: string
  skillName: string
}

export type SkillUseParseErrorCode =
  | 'missing-separator'
  | 'empty-package'
  | 'empty-skill'

export class SkillUseParseError extends Error {
  readonly code: SkillUseParseErrorCode
  readonly value: string

  constructor(code: SkillUseParseErrorCode, value: string) {
    super(formatSkillUseParseErrorMessage(code, value))
    this.name = 'SkillUseParseError'
    this.code = code
    this.value = value
  }
}

export function isSkillUseParseError(
  error: unknown,
): error is SkillUseParseError {
  return error instanceof SkillUseParseError
}

export function formatSkillUse(packageName: string, skillName: string): string {
  const pkg = packageName.trim()
  const skill = skillName.trim()

  if (pkg === '') {
    throw new SkillUseParseError('empty-package', `${packageName}#${skillName}`)
  }

  if (skill === '') {
    throw new SkillUseParseError('empty-skill', `${packageName}#${skillName}`)
  }

  return `${pkg}#${skill}`
}

export function parseSkillUse(value: string): SkillUse {
  const trimmed = value.trim()
  const separatorIndex = trimmed.indexOf('#')

  if (separatorIndex === -1) {
    throw new SkillUseParseError('missing-separator', value)
  }

  const packageName = trimmed.slice(0, separatorIndex).trim()
  const skillName = trimmed.slice(separatorIndex + 1).trim()

  if (packageName === '') {
    throw new SkillUseParseError('empty-package', value)
  }

  if (skillName === '') {
    throw new SkillUseParseError('empty-skill', value)
  }

  return { packageName, skillName }
}

function formatSkillUseParseErrorMessage(
  code: SkillUseParseErrorCode,
  value: string,
): string {
  switch (code) {
    case 'missing-separator':
      return `Invalid skill use "${value}": expected <package>#<skill>.`
    case 'empty-package':
      return `Invalid skill use "${value}": package is required.`
    case 'empty-skill':
      return `Invalid skill use "${value}": skill is required.`
  }
}
