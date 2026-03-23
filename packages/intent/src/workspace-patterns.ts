import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { findSkillFiles } from './utils.js'

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function normalizeWorkspacePatterns(
  patterns: Array<string>,
): Array<string> {
  return [
    ...new Set(patterns.map(normalizeWorkspacePattern).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b))
}

function parseWorkspacePatterns(value: unknown): Array<string> | null {
  if (!Array.isArray(value)) {
    return null
  }

  return normalizeWorkspacePatterns(
    value.filter((pattern): pattern is string => typeof pattern === 'string'),
  )
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'))
}

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

export function resolveWorkspacePackages(
  root: string,
  patterns: Array<string>,
): Array<string> {
  const dirs = new Set<string>()

  for (const pattern of normalizeWorkspacePatterns(patterns)) {
    const base = pattern.replace(/\/\*\*?(\/\*)?$/, '')
    const baseDir = join(root, base)
    if (!existsSync(baseDir)) continue

    if (pattern.includes('**')) {
      collectPackageDirs(baseDir, dirs)
    } else if (pattern.endsWith('/*')) {
      let entries: Array<Dirent>
      try {
        entries = readdirSync(baseDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = join(baseDir, entry.name)
        if (hasPackageJson(dir)) {
          dirs.add(dir)
        }
      }
    } else {
      const dir = join(root, pattern)
      if (hasPackageJson(dir)) {
        dirs.add(dir)
      }
    }
  }

  return [...dirs].sort((a, b) => a.localeCompare(b))
}

function collectPackageDirs(dir: string, result: Set<string>): void {
  if (hasPackageJson(dir)) {
    result.add(dir)
  }
  let entries: Array<Dirent>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err: unknown) {
    console.error(
      `Warning: could not read directory ${dir}: ${err instanceof Error ? err.message : err}`,
    )
    return
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name === 'node_modules' ||
      entry.name.startsWith('.')
    ) {
      continue
    }
    collectPackageDirs(join(dir, entry.name), result)
  }
}

export function findWorkspaceRoot(start: string): string | null {
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

export function findPackagesWithSkills(root: string): Array<string> {
  const patterns = readWorkspacePatterns(root)
  if (!patterns) return []

  return resolveWorkspacePackages(root, patterns).filter((dir) => {
    const skillsDir = join(dir, 'skills')
    return existsSync(skillsDir) && findSkillFiles(skillsDir).length > 0
  })
}
