const TRUE_LIKE_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function isEnvFlagSet(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value ? TRUE_LIKE_VALUES.has(value) : false
}
