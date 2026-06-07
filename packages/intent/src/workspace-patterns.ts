import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { parse as parseYaml } from 'yaml'
import { findSkillFiles } from './utils.js'
import type { ParseError } from 'jsonc-parser'

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function normalizeWorkspacePatterns(patterns: Array<string>): Array<string> {
  return [
    ...new Set(patterns.map(normalizeWorkspacePattern).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWorkspacePatternList(
  value: unknown,
  fieldName: string,
): Array<string> | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array of strings`)
  }

  if (value.some((pattern) => typeof pattern !== 'string')) {
    throw new TypeError(`${fieldName} must be an array of strings`)
  }

  return normalizeWorkspacePatterns(value)
}

function parseWorkspacePatternField(
  value: unknown,
  fieldName: string,
  nestedKey: string,
): Array<string> | null {
  if (value === undefined || value === null) {
    return null
  }

  if (Array.isArray(value)) {
    return parseWorkspacePatternList(value, fieldName)
  }

  if (isRecord(value)) {
    return parseWorkspacePatternList(
      value[nestedKey],
      `${fieldName}.${nestedKey}`,
    )
  }

  throw new TypeError(
    `${fieldName} must be an array of strings or an object with ${nestedKey}`,
  )
}

function hasWorkspaceManifest(dir: string): boolean {
  return (
    existsSync(join(dir, 'package.json')) ||
    existsSync(join(dir, 'deno.json')) ||
    existsSync(join(dir, 'deno.jsonc'))
  )
}

function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'))
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readJsoncFile(path: string): unknown {
  const errors: Array<ParseError> = []
  const value = parseJsonc(readFileSync(path, 'utf8'), errors, {
    allowTrailingComma: true,
  })

  if (errors.length > 0) {
    throw new SyntaxError(
      errors
        .map(
          (error) =>
            `JSONC parse error ${error.error} at offset ${error.offset}`,
        )
        .join('; '),
    )
  }

  return value
}

function warnConfigError(path: string, err: unknown): void {
  const verb = err instanceof SyntaxError ? 'parse' : 'read'
  console.error(
    `Warning: failed to ${verb} ${path}: ${err instanceof Error ? err.message : err}`,
  )
}

type WorkspacePatternSource = {
  fileName: string
  read: (path: string) => unknown
  getPatterns: (config: unknown) => Array<string> | null
}

export type WorkspaceInfo = {
  root: string
  patterns: Array<string>
  packageDirs: Array<string>
  packageDirsWithSkills: Array<string>
}

const workspacePatternSources: Array<WorkspacePatternSource> = [
  {
    fileName: 'pnpm-workspace.yaml',
    read: readYamlFile,
    getPatterns: (config) =>
      parseWorkspacePatternList(
        isRecord(config) ? config.packages : undefined,
        'pnpm-workspace.yaml#packages',
      ),
  },
  {
    fileName: 'package.json',
    read: readJsonFile,
    getPatterns: (config) =>
      parseWorkspacePatternField(
        isRecord(config) ? config.workspaces : undefined,
        'package.json#workspaces',
        'packages',
      ),
  },
  {
    fileName: 'deno.json',
    read: readJsoncFile,
    getPatterns: (config) =>
      parseWorkspacePatternField(
        isRecord(config) ? config.workspace : undefined,
        'deno.json#workspace',
        'members',
      ),
  },
  {
    fileName: 'deno.jsonc',
    read: readJsoncFile,
    getPatterns: (config) =>
      parseWorkspacePatternField(
        isRecord(config) ? config.workspace : undefined,
        'deno.jsonc#workspace',
        'members',
      ),
  },
]

const workspacePatternsCache = new Map<string, Array<string> | null>()
const workspaceRootCache = new Map<string, string | null>()
const workspacePackageDirsCache = new Map<string, Array<string> | null>()
const workspaceInfoCache = new Map<string, WorkspaceInfo | null>()

export function readWorkspacePatterns(root: string): Array<string> | null {
  if (workspacePatternsCache.has(root)) {
    return workspacePatternsCache.get(root) ?? null
  }

  const patterns = readWorkspacePatternsUncached(root)
  workspacePatternsCache.set(root, patterns)
  return patterns
}

function readWorkspacePatternsUncached(root: string): Array<string> | null {
  for (const source of workspacePatternSources) {
    const path = join(root, source.fileName)

    if (!existsSync(path)) {
      continue
    }

    try {
      const patterns = source.getPatterns(source.read(path))
      if (patterns) {
        return patterns
      }
    } catch (err: unknown) {
      warnConfigError(path, err)
    }
  }

  return null
}

function readWorkspacePackageDirs(root: string): Array<string> | null {
  if (workspacePackageDirsCache.has(root)) {
    return workspacePackageDirsCache.get(root) ?? null
  }

  const patterns = readWorkspacePatterns(root)
  if (!patterns) {
    workspacePackageDirsCache.set(root, null)
    return null
  }

  const packageDirs = resolveWorkspacePackages(root, patterns)
  workspacePackageDirsCache.set(root, packageDirs)
  return packageDirs
}

export function getWorkspaceInfo(root: string): WorkspaceInfo | null {
  if (workspaceInfoCache.has(root)) {
    return workspaceInfoCache.get(root) ?? null
  }

  const patterns = readWorkspacePatterns(root)
  if (!patterns) {
    workspaceInfoCache.set(root, null)
    return null
  }

  const packageDirs = readWorkspacePackageDirs(root) ?? []
  const packageDirsWithSkills = packageDirs.filter((dir) => {
    const skillsDir = join(dir, 'skills')
    return existsSync(skillsDir) && findSkillFiles(skillsDir).length > 0
  })
  const info = {
    root,
    patterns,
    packageDirs,
    packageDirsWithSkills,
  }

  workspaceInfoCache.set(root, info)
  return info
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
    if (hasWorkspaceManifest(dir)) {
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
  let prev: string | undefined
  const visited: Array<string> = []

  while (dir !== prev) {
    const cached = workspaceRootCache.get(dir)
    if (cached !== undefined) {
      for (const visitedDir of visited) {
        workspaceRootCache.set(visitedDir, cached)
      }
      return cached
    }

    visited.push(dir)

    if (readWorkspacePatterns(dir)) {
      for (const visitedDir of visited) {
        workspaceRootCache.set(visitedDir, dir)
      }
      return dir
    }

    prev = dir
    dir = dirname(dir)
  }

  for (const visitedDir of visited) {
    workspaceRootCache.set(visitedDir, null)
  }
  return null
}

export function findPackagesWithSkills(root: string): Array<string> {
  return getWorkspaceInfo(root)?.packageDirsWithSkills ?? []
}

export function findWorkspacePackages(root: string): Array<string> {
  return readWorkspacePackageDirs(root) ?? []
}
