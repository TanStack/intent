export const SESSION_CATALOGUE_MAX_BYTES = 8_000
export const SESSION_CATALOGUE_MAX_SKILLS = 50
export const SESSION_CATALOGUE_MAX_DESCRIPTION_LENGTH = 180

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function truncateText(value: string, maxLength: number): string {
  const codePoints = [...value]
  if (codePoints.length <= maxLength) return value
  return `${codePoints
    .slice(0, maxLength - 3)
    .join('')
    .trimEnd()}...`
}
