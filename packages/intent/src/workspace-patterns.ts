import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

  return normalizeWorkspacePatterns(
    value.filter((pattern): pattern is string => typeof pattern === 'string'),
  )
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'))
}

function stripJsonCommentsAndTrailingCommas(source: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    const next = source[index + 1]

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1
      }
      if (index < source.length) {
        result += source[index]!
      }
      continue
    }

    if (char === '/' && next === '*') {
      const commentStart = index
      index += 2
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1
      }
      if (index >= source.length) {
        throw new SyntaxError(
          `Unterminated block comment starting at position ${commentStart}`,
        )
      }
      index += 1
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < source.length) {
        const la = source[lookahead]!
        if (/\s/.test(la)) {
          lookahead += 1
        } else if (la === '/' && source[lookahead + 1] === '/') {
          lookahead += 2
          while (lookahead < source.length && source[lookahead] !== '\n') {
            lookahead += 1
          }
        } else if (la === '/' && source[lookahead + 1] === '*') {
          lookahead += 2
          while (
            lookahead < source.length &&
            !(source[lookahead] === '*' && source[lookahead + 1] === '/')
          ) {
            lookahead += 1
          }
          lookahead += 2
        } else {
          break
        }
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        continue
      }
    }

    result += char
  }

  return result
}

function readJsonFile(path: string, jsonc = false): unknown {
  const source = readFileSync(path, 'utf8')
  return JSON.parse(jsonc ? stripJsonCommentsAndTrailingCommas(source) : source)
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
      const verb = err instanceof SyntaxError ? 'parse' : 'read'
      console.error(
        `Warning: failed to ${verb} ${pnpmWs}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJsonFile(pkgPath) as Record<string, unknown>
      const workspaces = pkg.workspaces as Record<string, unknown> | undefined
      const patterns =
        parseWorkspacePatterns(workspaces) ??
        parseWorkspacePatterns(workspaces?.packages)
      if (patterns) {
        return patterns
      }
    } catch (err: unknown) {
      const verb = err instanceof SyntaxError ? 'parse' : 'read'
      console.error(
        `Warning: failed to ${verb} ${pkgPath}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  for (const denoConfigName of ['deno.json', 'deno.jsonc']) {
    const denoConfigPath = join(root, denoConfigName)
    if (!existsSync(denoConfigPath)) {
      continue
    }

    try {
      const denoConfig = readJsonFile(denoConfigPath, true) as Record<
        string,
        unknown
      >
      const patterns = parseWorkspacePatterns(denoConfig.workspace)
      if (patterns) {
        return patterns
      }
    } catch (err: unknown) {
      const verb = err instanceof SyntaxError ? 'parse' : 'read'
      console.error(
        `Warning: failed to ${verb} ${denoConfigPath}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  return null
}

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

/** Recursively matches path segments: `*` matches one level, `**` matches zero or more levels. */
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
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          !entry.name.startsWith('.'),
      )
      .map((entry) => join(dir, entry.name))
  } catch (err: unknown) {
    console.error(
      `Warning: could not read directory ${dir}: ${err instanceof Error ? err.message : err}`,
    )
    return []
  }
}

export function findWorkspaceRoot(start: string): string | null {
  let dir = start

  while (true) {
    if (readWorkspacePatterns(dir)) {
      return dir
    }

    const next = dirname(dir)
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

export function findWorkspacePackages(root: string): Array<string> {
  const patterns = readWorkspacePatterns(root)
  if (!patterns) return []

  return resolveWorkspacePackages(root, patterns)
}
