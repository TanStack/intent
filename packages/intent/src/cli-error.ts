export type CliFailure = {
  message: string
  exitCode: number
}

export function fail(message: string, exitCode = 1): never {
  throw { message, exitCode } satisfies CliFailure
}

export function isCliFailure(value: unknown): value is CliFailure {
  return (
    !!value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number'
  )
}
