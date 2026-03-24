import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import {
  findWorkspaceRoot,
  readWorkspacePatterns,
} from '../workspace-patterns.js'

export type ProjectContext = {
  cwd: string
  workspaceRoot: string | null
  packageRoot: string | null
  isMonorepo: boolean
  workspacePatterns: Array<string>
  targetPackageJsonPath: string | null
  targetSkillsDir: string | null
}

/**
 * Resolves project structure by walking up from targetPath (or cwd) to find the
 * owning package.json, then searches for a workspace root from the package root.
 * Falls back to searching from cwd when targetPath points deep into a package.
 */
export function resolveProjectContext({
  cwd,
  targetPath,
}: {
  cwd: string
  targetPath?: string
}): ProjectContext {
  const resolvedCwd = resolve(cwd)
  const resolvedTargetPath = targetPath
    ? resolve(resolvedCwd, targetPath)
    : resolvedCwd
  const packageRoot = findOwningPackageRoot(resolvedTargetPath)
  const workspaceRoot =
    findWorkspaceRoot(packageRoot ?? resolvedTargetPath) ??
    findWorkspaceRoot(resolvedCwd)
  const workspacePatterns = workspaceRoot
    ? (readWorkspacePatterns(workspaceRoot) ?? [])
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

function findOwningPackageRoot(startPath: string): string | null {
  let dir = toSearchDir(startPath)

  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir
    }

    const next = dirname(dir)
    if (next === dir) {
      return null
    }

    dir = next
  }
}

function toSearchDir(path: string): string {
  if (!existsSync(path)) {
    return path
  }

  return statSync(path).isDirectory() ? path : dirname(path)
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
