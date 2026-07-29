import { applyEdits, modify, parse } from 'jsonc-parser'
import { compileExcludePatterns } from '../../core/excludes.js'
import { parseSkillSources } from '../../core/skill-sources.js'

export interface IntentConsumerConfig {
  skills: Array<string>
  exclude: Array<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requireStringArray(value: unknown, label: string): Array<string> {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(`${label} must be an array of strings.`)
  }
  return value
}

function validateExcludes(excludes: Array<string>): void {
  if (excludes.some((entry) => entry.trim() === '')) {
    throw new Error('intent.exclude must not contain blank entries.')
  }
  compileExcludePatterns(excludes)
}

function parsePackageJson(text: string): Record<string, unknown> {
  const errors: Array<{ error: number; offset: number; length: number }> = []
  const value = parse(text.replace(/^\ufeff/, ''), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0 || !isRecord(value)) {
    throw new Error('Invalid package.json JSONC.')
  }
  return value
}

export function hasIntentDevDependency(text: string): boolean {
  const devDependencies = parsePackageJson(text).devDependencies
  return (
    isRecord(devDependencies) &&
    typeof devDependencies['@tanstack/intent'] === 'string'
  )
}

export function readIntentConsumerConfig(text: string): IntentConsumerConfig {
  const packageJson = parsePackageJson(text)
  const intent = packageJson.intent
  if (intent === undefined) return { skills: [], exclude: [] }
  if (!isRecord(intent)) throw new Error('intent must be an object.')
  const skills =
    intent.skills === undefined
      ? []
      : requireStringArray(intent.skills, 'intent.skills')
  const exclude =
    intent.exclude === undefined
      ? []
      : requireStringArray(intent.exclude, 'intent.exclude')
  parseSkillSources(skills)
  validateExcludes(exclude)
  return { skills, exclude }
}

function equalsConfig(
  left: IntentConsumerConfig,
  right: IntentConsumerConfig,
): boolean {
  return (
    equalsArray(left.skills, right.skills) &&
    equalsArray(left.exclude, right.exclude)
  )
}

function equalsArray(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  )
}

function formattingOptions(text: string): {
  eol: string
  insertSpaces: boolean
  tabSize: number
} {
  const indentation = /\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  return {
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  }
}

function applyModification(
  text: string,
  path: Array<string>,
  value: unknown,
  options: ReturnType<typeof formattingOptions>,
): string {
  return applyEdits(
    text,
    modify(text, path, value, { formattingOptions: options }),
  )
}

export function updateIntentConsumerConfigText(
  text: string,
  requested: IntentConsumerConfig,
): string {
  const existing = readIntentConsumerConfig(text)
  const intent = parsePackageJson(text).intent
  const hasLegacyInstall = isRecord(intent) && intent.install !== undefined
  const normalized = {
    skills: requireStringArray(requested.skills, 'intent.skills'),
    exclude: requireStringArray(requested.exclude, 'intent.exclude'),
  }
  parseSkillSources(normalized.skills)
  validateExcludes(normalized.exclude)
  if (equalsConfig(existing, normalized) && !hasLegacyInstall) {
    return text
  }

  const bom = text.startsWith('\ufeff') ? '\ufeff' : ''
  const options = formattingOptions(text)
  let updated = bom === '' ? text : text.slice(1)
  if (!equalsArray(existing.skills, normalized.skills)) {
    updated = applyModification(
      updated,
      ['intent', 'skills'],
      normalized.skills,
      options,
    )
  }
  if (!equalsArray(existing.exclude, normalized.exclude)) {
    updated = applyModification(
      updated,
      ['intent', 'exclude'],
      normalized.exclude,
      options,
    )
  }
  if (hasLegacyInstall) {
    updated = applyModification(
      updated,
      ['intent', 'install'],
      undefined,
      options,
    )
  }
  return `${bom}${updated}`
}
