export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function stringArray(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}
