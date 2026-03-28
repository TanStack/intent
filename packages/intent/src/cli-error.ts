const CLI_FAILURE = Symbol('CliFailure')

export type CliFailure = {
  readonly [CLI_FAILURE]: true
  message: string
  exitCode: number
}

// Throws a structured CliFailure (not an Error) — this represents an expected
// user-facing failure, not an internal bug. Stack traces are intentionally
// omitted since these are anticipated exit paths (bad input, missing files, etc).
export function fail(message: string, exitCode = 1): never {
  throw { [CLI_FAILURE]: true as const, message, exitCode } satisfies CliFailure
}

export function isCliFailure(value: unknown): value is CliFailure {
  return !!value && typeof value === 'object' && CLI_FAILURE in value
}
