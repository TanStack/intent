import { existsSync, readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { findSkillFiles } from './utils.js'

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function normalizeWorkspacePatterns(patterns: Array<string>): Array<string> {
  return [
    ...new Set(patterns.map(normalizeWorkspacePattern).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b))
}

function parseWorkspacePatterns(value: unknown): Array<string> | null {
  if (!Array.isArray(value)) {
    return null
  }

  const normalized = normalizeWorkspacePatterns(
    value.filter((pattern): pattern is string => typeof pattern === 'string'),
  )
  return normalized.length > 0 ? normalized : null
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'))
}

/** Reads workspace patterns from pnpm-workspace.yaml (preferred) or package.json workspaces. Returns null if no workspace config is found. */
export function readWorkspacePatterns(root: string): Array<string> | null {
  const pnpmWs = join(root, 'pnpm-workspace.yaml')
  if (existsSync(pnpmWs)) {
    try {
      const config = parseYaml(readFileSync(pnpmWs, 'utf8')) as Record<
        string,
        unknown
      >
      const patterns = parseWorkspacePatterns(config.packages)
      if (patterns) {
        return patterns
      }
    } catch (err: unknown) {
      console.error(
        `Warning: failed to parse ${pnpmWs}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const workspaces = parseWorkspacePatterns(pkg.workspaces)
      if (workspaces) {
        return workspaces
      }

      const workspacePackages = parseWorkspacePatterns(pkg.workspaces?.packages)
      if (workspacePackages) {
        return workspacePackages
      }
    } catch (err: unknown) {
      console.error(
        `Warning: failed to parse ${pkgPath}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  return null
}

/** Resolves workspace glob patterns to package directories. Supports `*`, `**`, and `!` exclusion patterns. */
export function resolveWorkspacePackages(
  root: string,
  patterns: Array<string>,
): Array<string> {
  const includedDirs = new Set<string>()
  const excludedDirs = new Set<string>()

  for (const pattern of normalizeWorkspacePatterns(patterns)) {
    if (pattern.startsWith('!')) {
      resolveWorkspacePatternSegments(
        root,
        pattern.slice(1).split('/'),
        excludedDirs,
      )
      continue
    }

    resolveWorkspacePatternSegments(root, pattern.split('/'), includedDirs)
  }

  return [...includedDirs]
    .filter((dir) => !excludedDirs.has(dir))
    .sort((a, b) => a.localeCompare(b))
}

function resolveWorkspacePatternSegments(
  dir: string,
  segments: Array<string>,
  result: Set<string>,
): void {
  if (segments.length === 0) {
    if (hasPackageJson(dir)) {
      result.add(dir)
    }
    return
  }

  const segment = segments[0]!
  const remainingSegments = segments.slice(1)

  if (segment === '**') {
    resolveWorkspacePatternSegments(dir, remainingSegments, result)
    for (const childDir of readChildDirectories(dir)) {
      resolveWorkspacePatternSegments(childDir, segments, result)
    }
    return
  }

  if (segment === '*') {
    for (const childDir of readChildDirectories(dir)) {
      resolveWorkspacePatternSegments(childDir, remainingSegments, result)
    }
    return
  }

  const nextDir = join(dir, segment)
  if (!existsSync(nextDir)) {
    return
  }

  resolveWorkspacePatternSegments(nextDir, remainingSegments, result)
}

function readChildDirectories(dir: string): Array<string> {
  let entries: Array<Dirent>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err: unknown) {
    console.error(
      `Warning: could not read directory ${dir}: ${err instanceof Error ? err.message : err}`,
    )
    return []
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.'),
    )
    .map((entry) => join(dir, entry.name))
}

/** Walks up from `start` to find the nearest directory with a workspace config. */
export function findWorkspaceRoot(start: string): string | null {
  if (!isAbsolute(start)) {
    throw new Error(`findWorkspaceRoot requires an absolute path, got: ${start}`)
  }
  let dir = start

  while (true) {
    if (readWorkspacePatterns(dir)) {
      return dir
    }

    const next = join(dir, '..')
    if (next === dir) return null
    dir = next
  }
}

/** Finds workspace packages that contain at least one SKILL.md file. */
export function findPackagesWithSkills(root: string): Array<string> {
  const patterns = readWorkspacePatterns(root)
  if (!patterns) return []

  return resolveWorkspacePackages(root, patterns).filter((dir) => {
    const skillsDir = join(dir, 'skills')
    return existsSync(skillsDir) && findSkillFiles(skillsDir).length > 0
  })
}
