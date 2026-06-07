import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { resolveProjectContext } from './project-context.js'
import { readPackageJson } from './package-json.js'
import type { ProjectContext } from './project-context.js'
import type { IntentCoreOptions } from './types.js'

const MAX_EXCLUDE_PATTERN_LENGTH = 200
const PACKAGE_NAME_BOUNDARY = /[^a-zA-Z0-9_.-]/

export interface ExcludeMatcher {
  pattern: string
  matches: (packageName: string) => boolean
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

function getConfigExcludePatterns(
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

  return dirs.reverse().flatMap(readPackageExcludes)
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

function normalizeGlobPattern(pattern: string): string {
  if (pattern.length > MAX_EXCLUDE_PATTERN_LENGTH) {
    throw new Error(
      `Intent exclude pattern is too long: ${pattern.length} characters. Maximum is ${MAX_EXCLUDE_PATTERN_LENGTH}.`,
    )
  }

  return pattern.replace(/\*+/g, '*')
}

function globToRegExp(pattern: string): RegExp {
  const source = normalizeGlobPattern(pattern)
    .split('*')
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

export function compileExcludePatterns(
  patterns: Array<string>,
): Array<ExcludeMatcher> {
  return patterns.map((pattern) => {
    if (!pattern.includes('*')) {
      normalizeGlobPattern(pattern)
      return {
        pattern,
        matches: (packageName) => packageName === pattern,
      }
    }

    const regex = globToRegExp(pattern)
    return {
      pattern,
      matches: (packageName) => regex.test(packageName),
    }
  })
}

export function isPackageExcluded(
  packageName: string,
  matchers: Array<ExcludeMatcher>,
): boolean {
  return matchers.some((matcher) => matcher.matches(packageName))
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
