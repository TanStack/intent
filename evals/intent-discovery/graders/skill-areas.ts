import type { JsonValue } from 'vitest-evals'
import type { ExpectedSkillArea } from '../corpus/tasks'

const skillAreaPatterns: Record<ExpectedSkillArea, Array<RegExp>> = {
  router: [/router/i, /routing/i, /@tanstack\/router/i],
  start: [/tanstack start/i, /react-start/i, /server function/i, /full-stack/i],
  'table-v9': [
    /tanstack table/i,
    /react-table/i,
    /@tanstack\/react-table/i,
    /\btable[\s-]?v9\b/i,
  ],
}

export function jsonToSearchableText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

export function textMatchesSkillArea(
  text: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): boolean {
  return expectedSkillAreas.some((area) =>
    skillAreaPatterns[area].some((pattern) => pattern.test(text)),
  )
}

export function listIncludesExpectedSkillArea(
  values: Array<string>,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): boolean {
  return values.some((value) => textMatchesSkillArea(value, expectedSkillAreas))
}
