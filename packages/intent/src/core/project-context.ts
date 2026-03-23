import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
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

export function resolveProjectContext({
  cwd,
  targetPath,
}: {
  cwd: string
  targetPath?: string
}): ProjectContext {
  const resolvedCwd = resolve(cwd)
  const resolvedTargetPath = resolveTargetPath(resolvedCwd, targetPath)
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

function resolveTargetPath(cwd: string, targetPath?: string): string {
  if (!targetPath) {
    return cwd
  }

  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(cwd, targetPath)
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

  try {
    return statSync(path).isDirectory() ? path : dirname(path)
  } catch {
    return path
  }
}

function resolveTargetSkillsDir(
  targetPath: string,
  packageRoot: string | null,
): string | null {
  if (!packageRoot) {
    return null
  }

  const packageSkillsDir = join(packageRoot, 'skills')
  if (targetPath === packageSkillsDir) {
    return packageSkillsDir
  }

  if (isWithinDirectory(targetPath, packageSkillsDir)) {
    return packageSkillsDir
  }

  if (targetPath === packageRoot && existsSync(packageSkillsDir)) {
    return packageSkillsDir
  }

  return null
}

function isWithinDirectory(path: string, parentDir: string): boolean {
  const pathRelative = relative(parentDir, path)
  return pathRelative !== '' && !pathRelative.startsWith('..')
}
