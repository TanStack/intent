import { dirname, isAbsolute, relative } from 'node:path'
import { resolveProjectContext } from './project-context.js'
import { readPackageJson } from './package-json.js'
import type { IntentCoreOptions } from './types.js'

export function normalizeExcludePatterns(value: unknown): Array<string> {
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

function getConfigExcludePatterns(cwd: string): Array<string> {
  const context = resolveProjectContext({ cwd })
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
  options: IntentCoreOptions,
): Array<string> {
  return [
    ...getConfigExcludePatterns(process.cwd()),
    ...normalizeExcludePatterns(options.exclude),
  ]
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

function matchesPackageGlob(packageName: string, pattern: string): boolean {
  return pattern.includes('*')
    ? globToRegExp(pattern).test(packageName)
    : packageName === pattern
}

export function isPackageExcluded(
  packageName: string,
  patterns: Array<string>,
): boolean {
  return patterns.some((pattern) => matchesPackageGlob(packageName, pattern))
}

export function warningMentionsPackage(
  warning: string,
  packageName: string,
): boolean {
  const idx = warning.indexOf(packageName)
  if (idx === -1) return false

  const after = warning[idx + packageName.length]
  return after === undefined || /[^a-zA-Z0-9_-]/.test(after)
}
