// Static-discovery invariant: this module only inspects strings. It never
// resolves, requires, or executes any discovered package.

import { compileWildcardPattern } from './excludes.js'

/**
 * Exact entries keep the `kind` + `id` identity M2's lockfile reuses. Patterns
 * select multiple discovered identities and remain distinct from exact entries.
 * The `git` variant is never constructed in M1 (git entries are rejected at
 * parse time) but is defined here so M2 builds on this shape.
 */
type SkillSource =
  | ({ raw: string; kind: 'npm' | 'workspace'; skill?: string } & (
      | { id: string }
      | { pattern: string }
    ))
  | { raw: string; id: string; kind: 'git'; ref: string }

export type SkillSourcesConfig =
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
    return { mode: 'empty' }
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

    if (entry === '*') {
      allowAll = true
      continue
    }

    // Only the exact raw entry is the trust-all switch. Whitespace must not
    // turn a package pattern into allow-all after normalization.
    if (trimmed === '*') {
      issues.push({
        raw: entry,
        message: 'The "*" wildcard must be the exact entry "*".',
      })
      continue
    }

    const parsed = parseEntry(entry, trimmed)
    if ('message' in parsed) {
      issues.push(parsed)
      continue
    }

    const selector = 'pattern' in parsed ? parsed.pattern : parsed.id
    const skill = 'skill' in parsed ? parsed.skill : undefined
    const identity = `${parsed.kind}\u0000${selector}\u0000${skill ?? ''}`
    if (seenIdentity.has(identity)) continue
    seenIdentity.add(identity)
    sources.push(parsed)
  }

  if (!allowAll) {
    for (const source of sources) {
      const subsuming = findPackageLevelEntryCovering(source, sources)
      if (subsuming) {
        issues.push({
          raw: source.raw,
          message: `Entry "${source.raw.trim()}" is ambiguous: "${subsuming.raw.trim()}" already allows every skill in that package. Keep one.`,
        })
      }
    }
  }

  if (issues.length > 0) {
    throw new SkillSourcesParseError(issues)
  }

  if (allowAll) {
    return { mode: 'allow-all' }
  }

  return { mode: 'explicit', sources }
}

function findPackageLevelEntryCovering(
  source: SkillSource,
  sources: Array<SkillSource>,
): SkillSource | undefined {
  if (
    source.kind === 'git' ||
    !('id' in source) ||
    source.skill === undefined
  ) {
    return undefined
  }
  const { id, kind } = source
  return sources.find((other) => {
    if (other === source || other.kind === 'git') return false
    if (other.kind !== kind || other.skill !== undefined) return false
    return 'pattern' in other
      ? compileWildcardPattern(other.pattern)(id)
      : other.id === id
  })
}

function parseEntry(
  raw: string,
  trimmed: string,
): SkillSource | SkillSourceIssue {
  const colon = trimmed.indexOf(':')

  // npm names cannot contain ':', so a colon-free entry is unambiguously npm.
  if (colon === -1) {
    const split = splitSkillSelector(raw, trimmed, trimmed)
    if ('message' in split) return split
    const invalid = validateId(split.packageSegment)
    if (invalid)
      return { raw, message: `Invalid npm source "${trimmed}": ${invalid}` }
    return packageSource(raw, split.packageSegment, 'npm', split.skill)
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
      const split = splitSkillSelector(raw, trimmed, rest)
      if ('message' in split) return split
      const invalid = validateId(split.packageSegment)
      if (invalid) {
        return {
          raw,
          message: `Invalid workspace source "${trimmed}": ${invalid}`,
        }
      }
      return packageSource(raw, split.packageSegment, 'workspace', split.skill)
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

function splitSkillSelector(
  raw: string,
  trimmed: string,
  selector: string,
): { packageSegment: string; skill: string | null } | SkillSourceIssue {
  const hash = selector.indexOf('#')
  if (hash === -1) return { packageSegment: selector, skill: null }

  const packageSegment = selector.slice(0, hash)
  const skillSegment = selector.slice(hash + 1)

  if (skillSegment.includes('#')) {
    return { raw, message: `Entry "${trimmed}" has more than one "#".` }
  }
  if (packageSegment === '') {
    return {
      raw,
      message: `Entry "${trimmed}" is missing a package name before "#".`,
    }
  }
  if (skillSegment === '') {
    return {
      raw,
      message: `Entry "${trimmed}" is missing a skill name after "#".`,
    }
  }
  if (/\s/.test(skillSegment)) {
    return {
      raw,
      message: `Invalid skill selector in "${trimmed}": skill names cannot contain whitespace.`,
    }
  }

  return {
    packageSegment,
    skill: skillSegment.replace(/\*+/g, '*') === '*' ? null : skillSegment,
  }
}

function packageSource(
  raw: string,
  id: string,
  kind: 'npm' | 'workspace',
  skill: string | null,
): SkillSource {
  const source = id.includes('*')
    ? { raw, pattern: id, kind }
    : { raw, id, kind }
  return skill === null ? source : { ...source, skill }
}

function validateId(id: string): string | null {
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
