import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveSkillEntry, type ResolveSkillResult } from '../resolver.js'
import { scanIntentPackageAtRoot } from '../scanner.js'
import { resolveWorkspacePackages } from '../workspace-patterns.js'
import { getDeps, resolveDepDir } from '../utils.js'
import { warningMentionsPackage } from './excludes.js'
import { readPackageJson } from './package-json.js'
import {
  resolveProjectContext,
  type ProjectContext,
} from './project-context.js'
import type { SkillUse } from '../skill-use.js'
import type { IntentCoreOptions } from './types.js'

interface WorkspacePackageInfo {
  dir: string
  name: string | null
  packageJson: Record<string, unknown>
}

function readWorkspacePackageInfos(
  context: ProjectContext,
): Array<WorkspacePackageInfo> {
  const dirs = new Set<string>()

  if (context.packageRoot) {
    dirs.add(context.packageRoot)
  }

  if (context.workspaceRoot) {
    dirs.add(context.workspaceRoot)

    for (const dir of resolveWorkspacePackages(
      context.workspaceRoot,
      context.workspacePatterns,
    )) {
      dirs.add(dir)
    }
  }

  return [...dirs].flatMap((dir) => {
    const packageJson = readPackageJson(dir)
    if (!packageJson) return []

    return [
      {
        dir,
        name: typeof packageJson.name === 'string' ? packageJson.name : null,
        packageJson,
      },
    ]
  })
}

function addCandidateDir(
  candidates: Array<string>,
  seen: Set<string>,
  dir: string | null,
): void {
  if (!dir) return

  const key = resolve(dir)
  if (seen.has(key)) return

  seen.add(key)
  candidates.push(dir)
}

function findVisibleDependencyDir(
  packageName: string,
  fromDir: string,
): string | null {
  let dir = fromDir

  while (true) {
    const candidate = join(dir, 'node_modules', packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate

    const next = dirname(dir)
    if (next === dir) return null
    dir = next
  }
}

function resolveDependencyPackageDir(
  packageName: string,
  fromDir: string,
): string | null {
  return (
    findVisibleDependencyDir(packageName, fromDir) ??
    resolveDepDir(packageName, fromDir)
  )
}

function workspacePackageDeclaresDependency(
  packageJson: Record<string, unknown>,
  packageName: string,
): boolean {
  return getDeps(packageJson).includes(packageName)
}

function hasYarnPnpFile(dir: string | null): boolean {
  return (
    dir !== null &&
    (existsSync(join(dir, '.pnp.cjs')) || existsSync(join(dir, '.pnp.js')))
  )
}

function shouldSkipFastPathForYarnPnp(
  context: ProjectContext,
  cwd: string,
): boolean {
  return hasYarnPnpFile(cwd) || hasYarnPnpFile(context.workspaceRoot)
}

function getDirectLoadFastPathCandidateDirs(
  packageName: string,
  context: ProjectContext,
  cwd: string,
): Array<string> {
  const candidates: Array<string> = []
  const seen = new Set<string>()

  if (!context.workspaceRoot) {
    addCandidateDir(
      candidates,
      seen,
      resolveDependencyPackageDir(packageName, context.packageRoot ?? cwd),
    )
    return candidates
  }

  addCandidateDir(
    candidates,
    seen,
    resolveDependencyPackageDir(
      packageName,
      context.packageRoot ?? context.workspaceRoot ?? cwd,
    ),
  )

  if (context.workspaceRoot && context.workspaceRoot !== context.packageRoot) {
    addCandidateDir(
      candidates,
      seen,
      resolveDependencyPackageDir(packageName, context.workspaceRoot),
    )
  }

  return candidates
}

function getWorkspaceLoadFastPathCandidateDirs(
  packageName: string,
  context: ProjectContext,
): Array<string> {
  const candidates: Array<string> = []
  const seen = new Set<string>()
  const workspacePackages = readWorkspacePackageInfos(context)

  for (const pkg of workspacePackages) {
    if (pkg.name === packageName) {
      addCandidateDir(candidates, seen, pkg.dir)
    }
  }

  for (const pkg of workspacePackages) {
    if (!workspacePackageDeclaresDependency(pkg.packageJson, packageName)) {
      continue
    }

    addCandidateDir(
      candidates,
      seen,
      resolveDependencyPackageDir(packageName, pkg.dir),
    )
  }

  return candidates
}

function resolveScannedPackageSkill(
  scanned: ReturnType<typeof scanIntentPackageAtRoot>,
  parsedUse: SkillUse,
): ResolveSkillResult | null {
  const pkg = scanned.package
  if (!pkg || pkg.name !== parsedUse.packageName) return null

  const skill = resolveSkillEntry(
    pkg.name,
    parsedUse.skillName,
    pkg.skills,
  ).skill
  if (!skill) return null

  return {
    packageName: pkg.name,
    skillName: skill.name,
    path: skill.path,
    source: pkg.source,
    version: pkg.version,
    packageRoot: pkg.packageRoot,
    warnings: scanned.warnings.filter((warning) =>
      warningMentionsPackage(warning, pkg.name),
    ),
    conflict: null,
  }
}

function resolveFromPackageRoots(
  packageRoots: Array<string>,
  parsedUse: SkillUse,
  cwd: string,
): ResolveSkillResult | null {
  for (const packageRoot of packageRoots) {
    const scanned = scanIntentPackageAtRoot(packageRoot, {
      fallbackName: parsedUse.packageName,
      projectRoot: cwd,
      skillNameHint: parsedUse.skillName,
    })
    const directResolved = resolveScannedPackageSkill(scanned, parsedUse)
    if (directResolved) return directResolved

    if (scanned.package?.name === parsedUse.packageName) {
      const fallbackScanned = scanIntentPackageAtRoot(packageRoot, {
        fallbackName: parsedUse.packageName,
        projectRoot: cwd,
      })
      const fallbackResolved = resolveScannedPackageSkill(
        fallbackScanned,
        parsedUse,
      )
      if (fallbackResolved) return fallbackResolved
    }
  }

  return null
}

export function resolveSkillUseFastPath(
  parsedUse: SkillUse,
  options: IntentCoreOptions,
  context = resolveProjectContext({ cwd: process.cwd() }),
  cwd = context.cwd,
): ResolveSkillResult | null {
  if (options.globalOnly) return null
  if (shouldSkipFastPathForYarnPnp(context, cwd)) return null

  const directResolved = resolveFromPackageRoots(
    getDirectLoadFastPathCandidateDirs(parsedUse.packageName, context, cwd),
    parsedUse,
    cwd,
  )
  if (directResolved) return directResolved

  if (!context.workspaceRoot) {
    return null
  }

  return resolveFromPackageRoots(
    getWorkspaceLoadFastPathCandidateDirs(parsedUse.packageName, context),
    parsedUse,
    cwd,
  )
}
