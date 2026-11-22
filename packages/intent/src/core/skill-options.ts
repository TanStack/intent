import { formatSkillUse } from '../skills/use.js'
import { getConfigDirs, skillNameVariants } from './excludes.js'
import { readPackageJson } from './package-json.js'
import type { IntentFsCache } from '../discovery/fs-cache.js'
import type { ProjectContext } from './project-context.js'

export const SKILL_OPTIONS_FILE = 'options.json'

interface SkillOption {
  question: string
  choices: Array<string>
  default: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function optionProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'must be an object'
  if (!isText(value.question)) return '"question" must be a non-empty string'
  if (
    !Array.isArray(value.choices) ||
    value.choices.length === 0 ||
    !value.choices.every(isText)
  ) {
    return '"choices" must be a non-empty array of non-empty strings'
  }
  if (
    typeof value.default !== 'string' ||
    !value.choices.includes(value.default)
  ) {
    return '"default" must be one of "choices"'
  }
  return undefined
}

export function parseSkillOptions(text: string): {
  options: Array<[string, SkillOption]>
  errors: Array<string>
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { options: [], errors: ['Invalid JSON'] }
  }
  if (!isRecord(parsed)) {
    return { options: [], errors: ['Expected a JSON object of options'] }
  }

  const options: Array<[string, SkillOption]> = []
  const errors: Array<string> = []
  for (const [name, value] of Object.entries(parsed)) {
    const problem = optionProblem(value)
    if (problem) errors.push(`Option "${name}": ${problem}`)
    else options.push([name, value as SkillOption])
  }
  return { options, errors }
}

export function readRecordedOptions(
  cwd: string,
  context: ProjectContext,
  fsCache: IntentFsCache,
  packageName: string,
  skillName: string,
): Record<string, unknown> {
  const keys = skillNameVariants(packageName, skillName).map((name) =>
    formatSkillUse(packageName, name),
  )
  const recorded: Record<string, unknown> = {}

  for (const dir of getConfigDirs(cwd, context).reverse()) {
    const intent = readPackageJson(dir, fsCache)?.intent
    const options = isRecord(intent) ? intent.options : undefined
    if (!isRecord(options)) continue
    for (const key of keys) {
      if (isRecord(options[key])) Object.assign(recorded, options[key])
    }
  }

  return recorded
}

export function appendProjectOptions(
  content: string,
  optionsText: string,
  use: string,
  recorded: Record<string, unknown>,
): { content: string; warnings: Array<string> } {
  const { options, errors } = parseSkillOptions(optionsText)
  if (errors.length > 0) {
    return {
      content,
      warnings: [
        `Ignored ${SKILL_OPTIONS_FILE} for "${use}": ${errors.join('; ')}`,
      ],
    }
  }
  if (options.length === 0) return { content, warnings: [] }

  const warnings: Array<string> = []
  const declared = new Set(options.map(([name]) => name))
  for (const name of Object.keys(recorded)) {
    if (!declared.has(name)) {
      warnings.push(
        `intent.options for "${use}": "${name}" is not an option of this skill.`,
      )
    }
  }

  const lines = options.map(([name, option]) => {
    const value = recorded[name]
    if (typeof value === 'string' && option.choices.includes(value)) {
      return `- ${name}: ${value}`
    }
    if (value !== undefined) {
      warnings.push(
        `intent.options for "${use}": "${name}" is ${JSON.stringify(value)}, which is not one of: ${option.choices.join(', ')}. Using the default.`,
      )
    }
    return `- ${name}: ${option.default} (default, not recorded). ${option.question} Choices: ${option.choices.join(', ')}.`
  })

  return {
    content: `${content.trimEnd()}\n\n## Project options\n\nChoices this project made for \`${use}\`, from \`intent.options\` in \`package.json\`. Follow the guidance that matches them.\n\n${lines.join('\n')}\n`,
    warnings,
  }
}
