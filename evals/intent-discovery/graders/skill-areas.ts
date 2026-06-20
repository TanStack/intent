import type { JsonValue } from 'vitest-evals'
import type { ExpectedSkillArea } from '../corpus/tasks'

const skillAreaPatterns: Record<ExpectedSkillArea, RegExp[]> = {
  router: [/router/i, /routing/i, /@tanstack\/router/i],
  query: [/query/i, /mutation/i, /@tanstack\/query/i],
  table: [/table/i, /column/i, /sorting/i, /@tanstack\/table/i],
  form: [/form/i, /validation/i, /submit/i, /@tanstack\/form/i],
  start: [/start/i, /full-stack/i, /@tanstack\/start/i],
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
  expectedSkillAreas: ExpectedSkillArea[],
): boolean {
  return expectedSkillAreas.some((area) =>
    skillAreaPatterns[area].some((pattern) => pattern.test(text)),
  )
}

export function listIncludesExpectedSkillArea(
  values: string[],
  expectedSkillAreas: ExpectedSkillArea[],
): boolean {
  return values.some((value) => textMatchesSkillArea(value, expectedSkillAreas))
}
