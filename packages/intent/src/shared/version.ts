/**
 * Minimal semver helpers for the discovery scan path.
 *
 * The scanner only needs to pick the newer of two installed versions of the
 * same package, and only when a duplicate is found. Pulling in the `semver`
 * package for that cost ~28ms of module loading (46 CommonJS files) on every
 * `intent list`, so this module reimplements just the three operations the
 * scanner uses — `valid`, `coerce`, and `compare` — with the same results.
 * Staleness checks still use `semver` for its richer API; they run only on
 * `intent stale`.
 */

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: Array<string | number>
}

// Mirrors semver's strict `FULL` pattern: optional `v`, three numeric
// identifiers without leading zeros, optional prerelease and build metadata.
const NUMERIC = '0|[1-9]\\d*'
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC}|\\d*[a-zA-Z-][a-zA-Z0-9-]*)`
const BUILD_IDENTIFIER = '[0-9A-Za-z-]+'
const FULL_VERSION = new RegExp(
  `^v?(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})` +
    `(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?` +
    `(?:\\+${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*)?$`,
)

// Mirrors semver's `COERCE` pattern: the first run of up to three dotted
// numeric groups, each at most 16 digits, not embedded in a longer number.
const COERCE =
  /(?:^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|[^\d])/

const MAX_VERSION_LENGTH = 256

function toNumber(value: string): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseVersion(version: string): ParsedVersion | null {
  const trimmed = version.trim()
  if (trimmed.length > MAX_VERSION_LENGTH) return null
  const match = FULL_VERSION.exec(trimmed)
  if (!match) return null

  const major = toNumber(match[1]!)
  const minor = toNumber(match[2]!)
  const patch = toNumber(match[3]!)
  if (major === null || minor === null || patch === null) return null

  const prerelease = match[4]
    ? match[4].split('.').map((identifier) => {
        if (!/^\d+$/.test(identifier)) return identifier
        const numeric = Number(identifier)
        return Number.isSafeInteger(numeric) ? numeric : identifier
      })
    : []

  return { major, minor, patch, prerelease }
}

function formatVersion(parsed: ParsedVersion): string {
  const main = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return parsed.prerelease.length > 0
    ? `${main}-${parsed.prerelease.join('.')}`
    : main
}

/**
 * Equivalent to `semver.valid(version)`: the normalized version string (no
 * leading `v`, no build metadata) when `version` is strict semver, else null.
 */
export function validVersion(version: string): string | null {
  const parsed = parseVersion(version)
  return parsed ? formatVersion(parsed) : null
}

/**
 * Equivalent to `semver.coerce(version)?.version`: the first `x[.y[.z]]`
 * run in `version` padded to `x.y.z`, else null.
 */
export function coerceVersion(version: string): string | null {
  const match = COERCE.exec(version)
  if (!match) return null
  // Like semver, the coerced triple must itself be strict semver: leading
  // zeros and numbers above MAX_SAFE_INTEGER make the result null.
  return validVersion(`${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}`)
}

/**
 * `validVersion(version)` when it is strict semver, otherwise the coerced
 * form; null when neither applies.
 */
export function normalizeVersion(version: string): string | null {
  return validVersion(version) ?? coerceVersion(version)
}

function compareIdentifiers(a: string | number, b: string | number): number {
  const aNumeric = typeof a === 'number'
  const bNumeric = typeof b === 'number'
  if (aNumeric && bNumeric) return a === b ? 0 : a < b ? -1 : 1
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

function comparePrerelease(
  a: Array<string | number>,
  b: Array<string | number>,
): number {
  // A version without a prerelease has higher precedence than one with.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a[index]
    const right = b[index]
    // A longer identifier list wins once every shared identifier matches.
    if (left === undefined) return -1
    if (right === undefined) return 1
    const result = compareIdentifiers(left, right)
    if (result !== 0) return result
  }
  return 0
}

/**
 * Equivalent to `semver.compare(a, b)` for two strict semver strings: -1, 0,
 * or 1 by semver precedence. Throws on input that is not strict semver, as
 * `semver.compare` does.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left) throw new TypeError(`Invalid Version: ${a}`)
  if (!right) throw new TypeError(`Invalid Version: ${b}`)

  return (
    compareNumbers(left.major, right.major) ||
    compareNumbers(left.minor, right.minor) ||
    compareNumbers(left.patch, right.patch) ||
    comparePrerelease(left.prerelease, right.prerelease)
  )
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1
}
