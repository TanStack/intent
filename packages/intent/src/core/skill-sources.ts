// Static-discovery invariant: this module only inspects strings. It never
// resolves, requires, or executes any discovered package.

/**
 * `kind` + `id` is the identity M2's lockfile reuses; `ref` exists only on
 * `git`. The `git` variant is never constructed in M1 (git entries are rejected
 * at parse time) but is defined here so M2 builds on this shape.
 */
export type SkillSource =
  | { raw: string; id: string; kind: 'npm' }
  | { raw: string; id: string; kind: 'workspace' }
  | { raw: string; id: string; kind: 'git'; ref: string }

/**
 * `absent` (key missing, v0 upgrade path) and `empty` (`[]`) are deliberately
 * distinct: absent is show-all, empty is deny-all.
 */
export type SkillSourcesConfig =
  | { mode: 'absent' }
  | { mode: 'empty' }
  | { mode: 'allow-all' }
  | { mode: 'explicit'; sources: Array<SkillSource> }

export interface SkillSourceIssue {
  raw: string | null
  message: string
}

export class SkillSourcesParseError extends Error {
  readonly issues: Array<SkillSourceIssue>

  constructor(issues: Array<SkillSourceIssue>) {
    super(formatIssues(issues))
    this.name = 'SkillSourcesParseError'
    this.issues = issues
  }
}

export function isSkillSourcesParseError(
  error: unknown,
): error is SkillSourcesParseError {
  return error instanceof SkillSourcesParseError
}

/**
 * Strictness is fail-whole-list: every malformed entry is collected and
 * reported together, and a single bad entry rejects the entire list rather
 * than silently applying a partial allowlist.
 */
export function parseSkillSources(value: unknown): SkillSourcesConfig {
  if (value === undefined || value === null) {
    return { mode: 'absent' }
  }

  if (!Array.isArray(value)) {
    throw new SkillSourcesParseError([
      {
        raw: null,
        message: `intent.skills must be an array of source strings, received ${describeType(
          value,
        )}.`,
      },
    ])
  }

  if (value.length === 0) {
    return { mode: 'empty' }
  }

  const issues: Array<SkillSourceIssue> = []
  const sources: Array<SkillSource> = []
  const seenRaw = new Set<string>()
  const seenIdentity = new Set<string>()
  let allowAll = false

  for (const entry of value) {
    if (typeof entry !== 'string') {
      issues.push({
        raw: null,
        message: `Entry must be a string, received ${describeType(entry)}.`,
      })
      continue
    }

    if (seenRaw.has(entry)) {
      issues.push({ raw: entry, message: 'Duplicate entry.' })
      continue
    }
    seenRaw.add(entry)

    const trimmed = entry.trim()
    if (trimmed === '') {
      issues.push({ raw: entry, message: 'Entry is empty.' })
      continue
    }

    // The wildcard is a trust-all switch, so it must be the exact string `"*"`.
    // Any other entry containing `*` (whitespace-wrapped, or a glob like
    // `@scope/*`) is rejected rather than silently flipping to allow-all or
    // becoming a bogus source — `intent.skills` is not glob-matched.
    if (entry.includes('*')) {
      if (entry === '*') {
        allowAll = true
        continue
      }
      issues.push({
        raw: entry,
        message:
          'The "*" wildcard must be the exact entry "*"; globs are not supported in intent.skills.',
      })
      continue
    }

    const parsed = parseEntry(entry, trimmed)
    if ('message' in parsed) {
      issues.push(parsed)
      continue
    }

    const identity = `${parsed.kind}\u0000${parsed.id}`
    if (seenIdentity.has(identity)) continue
    seenIdentity.add(identity)
    sources.push(parsed)
  }

  if (issues.length > 0) {
    throw new SkillSourcesParseError(issues)
  }

  if (allowAll) {
    return { mode: 'allow-all' }
  }

  return { mode: 'explicit', sources }
}

function parseEntry(
  raw: string,
  trimmed: string,
): SkillSource | SkillSourceIssue {
  const colon = trimmed.indexOf(':')

  // npm names cannot contain ':', so a colon-free entry is unambiguously npm.
  if (colon === -1) {
    const invalid = validateId(trimmed)
    if (invalid)
      return { raw, message: `Invalid npm source "${trimmed}": ${invalid}` }
    return { raw, id: trimmed, kind: 'npm' }
  }

  const prefix = trimmed.slice(0, colon)
  const rest = trimmed.slice(colon + 1).trim()

  switch (prefix) {
    case 'workspace': {
      if (rest === '') {
        return {
          raw,
          message: `Workspace source "${trimmed}" is missing a package name.`,
        }
      }
      const invalid = validateId(rest)
      if (invalid) {
        return {
          raw,
          message: `Invalid workspace source "${trimmed}": ${invalid}`,
        }
      }
      return { raw, id: rest, kind: 'workspace' }
    }
    case 'git':
      return {
        raw,
        message: `Git source "${trimmed}" is not supported until the lockfile lands (M2).`,
      }
    default:
      return {
        raw,
        message: `Unknown source prefix "${prefix}" in "${trimmed}".`,
      }
  }
}

function validateId(id: string): string | null {
  if (id.includes('#')) {
    return 'skill-level granularity (#) is not supported in intent.skills (it is package-level); use intent.exclude for skill-level control.'
  }
  if (/\s/.test(id)) {
    return 'package names cannot contain whitespace.'
  }
  if (id.includes(':')) {
    return 'package names cannot contain ":".'
  }
  return null
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  return Array.isArray(value) ? 'array' : typeof value
}

function formatIssues(issues: Array<SkillSourceIssue>): string {
  const lines = issues.map((issue) =>
    issue.raw === null
      ? `  - ${issue.message}`
      : `  - "${issue.raw}": ${issue.message}`,
  )
  return ['Invalid intent.skills configuration:', ...lines].join('\n')
}
