import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { resolveProjectContext } from './project-context.js'
import { readPackageJson } from './package-json.js'
import type { ProjectContext } from './project-context.js'
import type { IntentCoreOptions } from './types.js'

const MAX_EXCLUDE_PATTERN_LENGTH = 200
const PACKAGE_NAME_BOUNDARY = /[^a-zA-Z0-9_.-]/

export interface ExcludeMatcher {
  pattern: string
  matchesPackage: (packageName: string) => boolean
  matchesSkill?: (skillName: string) => boolean
}

function normalizeExcludePatterns(value: unknown): Array<string> {
  if (!Array.isArray(value)) return []

  return value
    .filter((pattern): pattern is string => typeof pattern === 'string')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
}

function isWithinOrEqual(path: string, parentDir: string): boolean {
  const rel = relative(parentDir, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function readPackageExcludes(dir: string): Array<string> {
  const pkg = readPackageJson(dir)
  const intent = pkg?.intent
  if (!intent || typeof intent !== 'object') return []

  return normalizeExcludePatterns((intent as Record<string, unknown>).exclude)
}

export function getConfigDirs(
  cwd: string,
  context = resolveProjectContext({ cwd }),
): Array<string> {
  const root = context.workspaceRoot ?? context.packageRoot ?? cwd
  const dirs: Array<string> = []
  let dir = cwd

  while (isWithinOrEqual(dir, root)) {
    dirs.push(dir)
    if (dir === root) break

    const next = dirname(dir)
    if (next === dir) break
    dir = next
  }

  return dirs
}

function getConfigExcludePatterns(
  cwd: string,
  context = resolveProjectContext({ cwd }),
): Array<string> {
  return [...getConfigDirs(cwd, context)].reverse().flatMap(readPackageExcludes)
}

export function getEffectiveExcludePatterns(
  options: IntentCoreOptions = {},
  context?: ProjectContext,
): Array<string> {
  const cwd =
    context?.cwd ?? resolve(process.cwd(), options.cwd ?? process.cwd())
  return [
    ...getConfigExcludePatterns(cwd, context),
    ...normalizeExcludePatterns(options.exclude),
  ]
}

function assertPatternLength(pattern: string): void {
  if (pattern.length > MAX_EXCLUDE_PATTERN_LENGTH) {
    throw new Error(
      `Intent exclude pattern is too long: ${pattern.length} characters. Maximum is ${MAX_EXCLUDE_PATTERN_LENGTH}.`,
    )
  }
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/\*+/g, '*')
    .split('*')
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

function compileSegment(segment: string): (value: string) => boolean {
  if (!segment.includes('*')) {
    return (value) => value === segment
  }

  const regex = globToRegExp(segment)
  return (value) => regex.test(value)
}

export function compileExcludePatterns(
  patterns: Array<string>,
): Array<ExcludeMatcher> {
  return patterns.map((pattern) => {
    assertPatternLength(pattern)

    const hashIndex = pattern.indexOf('#')
    if (hashIndex === -1) {
      return { pattern, matchesPackage: compileSegment(pattern) }
    }

    const packageSegment = pattern.slice(0, hashIndex)
    const skillSegment = pattern.slice(hashIndex + 1)

    if (skillSegment.replace(/\*+/g, '*') === '*') {
      return { pattern, matchesPackage: compileSegment(packageSegment) }
    }

    return {
      pattern,
      matchesPackage: compileSegment(packageSegment),
      matchesSkill: compileSegment(skillSegment),
    }
  })
}

export function isPackageExcluded(
  packageName: string,
  matchers: Array<ExcludeMatcher>,
): boolean {
  return matchers.some(
    (matcher) =>
      matcher.matchesSkill === undefined && matcher.matchesPackage(packageName),
  )
}

// A prefixed skill is loadable by its short alias too; an exclude must match either form.
function skillNameVariants(
  packageName: string,
  skillName: string,
): Array<string> {
  const shortName = packageName.split('/').pop() ?? packageName
  const prefix = `${shortName}/`
  if (skillName.startsWith(prefix)) {
    return [skillName, skillName.slice(prefix.length)]
  }
  return [skillName, `${prefix}${skillName}`]
}

export function isSkillExcluded(
  packageName: string,
  skillName: string,
  matchers: Array<ExcludeMatcher>,
): boolean {
  const variants = skillNameVariants(packageName, skillName)
  return matchers.some((matcher) => {
    if (!matcher.matchesPackage(packageName)) return false
    if (matcher.matchesSkill === undefined) return true
    return variants.some((variant) => matcher.matchesSkill!(variant))
  })
}

export function warningMentionsPackage(
  warning: string,
  packageName: string,
): boolean {
  let idx = warning.indexOf(packageName)

  while (idx !== -1) {
    const before = warning[idx - 1]
    const after = warning[idx + packageName.length]
    if (
      (before === undefined || PACKAGE_NAME_BOUNDARY.test(before)) &&
      (after === undefined || PACKAGE_NAME_BOUNDARY.test(after))
    ) {
      return true
    }

    idx = warning.indexOf(packageName, idx + packageName.length)
  }

  return false
}
