import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import {
  findWorkspaceRoot,
  readWorkspacePatterns,
} from '../setup/workspace-patterns.js'
import type { IntentFsCache } from '../discovery/fs-cache.js'

export type ProjectContext = {
  cwd: string
  workspaceRoot: string | null
  packageRoot: string | null
  isMonorepo: boolean
  workspacePatterns: Array<string>
  targetPackageJsonPath: string | null
  targetSkillsDir: string | null
}

const packageRootCaches = new WeakMap<
  IntentFsCache,
  Map<string, string | null>
>()

/**
 * Resolves project structure by walking up from targetPath (or cwd) to find the
 * owning package.json, then searches for a workspace root from the package root.
 * The target owns its ancestry; caller cwd cannot override a standalone target.
 */
export function resolveProjectContext({
  cwd,
  targetPath,
  fsCache = createIntentFsCache(),
}: {
  cwd: string
  targetPath?: string
  fsCache?: IntentFsCache
}): ProjectContext {
  const resolvedCwd = resolve(cwd)
  const resolvedTargetPath = targetPath
    ? resolve(resolvedCwd, targetPath)
    : resolvedCwd
  const packageRoot = findOwningPackageRoot(resolvedTargetPath, fsCache)
  const workspaceRoot = findWorkspaceRoot(
    packageRoot ?? resolvedTargetPath,
    fsCache,
  )
  const workspacePatterns = workspaceRoot
    ? (readWorkspacePatterns(workspaceRoot, fsCache) ?? [])
    : []

  return {
    cwd: resolvedCwd,
    workspaceRoot,
    packageRoot,
    isMonorepo: workspaceRoot !== null,
    workspacePatterns,
    targetPackageJsonPath: packageRoot
      ? join(packageRoot, 'package.json')
      : null,
    targetSkillsDir: resolveTargetSkillsDir(resolvedTargetPath, packageRoot),
  }
}

function findOwningPackageRoot(
  startPath: string,
  fsCache?: IntentFsCache,
): string | null {
  let cache = fsCache ? packageRootCaches.get(fsCache) : undefined
  if (fsCache && !cache) {
    cache = new Map()
    packageRootCaches.set(fsCache, cache)
  }
  const cachedStart = cache?.get(startPath)
  if (cachedStart !== undefined) return cachedStart

  let dir = toSearchDir(startPath)
  let prev: string | undefined
  const visited: Array<string> = [startPath]

  while (dir !== prev) {
    const cached = cache?.get(dir)
    if (cached !== undefined) {
      for (const visitedDir of visited) cache?.set(visitedDir, cached)
      return cached
    }
    visited.push(dir)
    if (existsSync(join(dir, 'package.json'))) {
      for (const visitedDir of visited) cache?.set(visitedDir, dir)
      return dir
    }

    if (existsSync(join(dir, '.git'))) break

    prev = dir
    dir = dirname(dir)
  }

  for (const visitedDir of visited) cache?.set(visitedDir, null)
  return null
}

function toSearchDir(path: string): string {
  const stat = statSync(path, { throwIfNoEntry: false })
  if (!stat) {
    return path
  }

  return stat.isDirectory() ? path : dirname(path)
}

function resolveTargetSkillsDir(
  targetPath: string,
  packageRoot: string | null,
): string | null {
  if (!packageRoot) {
    return null
  }

  const packageSkillsDir = join(packageRoot, 'skills')

  if (isWithinOrEqual(targetPath, packageSkillsDir)) {
    return packageSkillsDir
  }

  if (targetPath === packageRoot && existsSync(packageSkillsDir)) {
    return packageSkillsDir
  }

  return null
}

function isWithinOrEqual(path: string, parentDir: string): boolean {
  const rel = relative(parentDir, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}
