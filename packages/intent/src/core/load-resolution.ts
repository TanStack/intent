import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveSkillEntry } from '../skills/resolver.js'
import { scanIntentPackageAtRoot } from '../discovery/scanner.js'
import { getDeps } from '../shared/utils.js'
import { findWorkspacePackages } from './workspace-patterns.js'
import { warningMentionsPackage } from './excludes.js'
import type { ResolveSkillResult } from '../skills/resolver.js'
import type { IntentFsCache } from '../discovery/fs-cache.js'
import type { ProjectContext } from './project-context.js'
import type { SkillUse } from '../skills/use.js'
import type { IntentCoreOptions } from './types.js'

interface WorkspacePackageInfo {
  dir: string
  name: string | null
  packageJson: Record<string, unknown>
}

function readWorkspacePackageInfos(
  context: ProjectContext,
  fsCache: IntentFsCache,
): Array<WorkspacePackageInfo> {
  const dirs = new Set<string>()

  if (context.packageRoot) {
    dirs.add(context.packageRoot)
  }

  if (context.workspaceRoot) {
    dirs.add(context.workspaceRoot)

    for (const dir of findWorkspacePackages(context.workspaceRoot, fsCache)) {
      dirs.add(dir)
    }
  }

  return [...dirs].flatMap((dir) => {
    const packageJson = fsCache.readPackageJson(dir)
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
  let prev: string | undefined

  while (dir !== prev) {
    const candidate = join(dir, 'node_modules', packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate

    prev = dir
    dir = dirname(dir)
  }

  return null
}

function hasYarnPnpFile(dir: string | null): boolean {
  return (
    dir !== null &&
    (existsSync(join(dir, '.pnp.cjs')) || existsSync(join(dir, '.pnp.js')))
  )
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
      findVisibleDependencyDir(packageName, context.packageRoot ?? cwd),
    )
    return candidates
  }

  addCandidateDir(
    candidates,
    seen,
    findVisibleDependencyDir(
      packageName,
      context.packageRoot ?? context.workspaceRoot,
    ),
  )

  if (context.workspaceRoot !== context.packageRoot) {
    addCandidateDir(
      candidates,
      seen,
      findVisibleDependencyDir(packageName, context.workspaceRoot),
    )
  }

  return candidates
}

function getWorkspaceLoadFastPathCandidateDirs(
  packageName: string,
  context: ProjectContext,
  fsCache: IntentFsCache,
): Array<string> {
  const candidates: Array<string> = []
  const seen = new Set<string>()
  const workspacePackages = readWorkspacePackageInfos(context, fsCache)

  for (const pkg of workspacePackages) {
    if (pkg.name === packageName) {
      addCandidateDir(candidates, seen, pkg.dir)
    }
  }

  for (const pkg of workspacePackages) {
    if (!getDeps(pkg.packageJson).includes(packageName)) continue

    addCandidateDir(
      candidates,
      seen,
      findVisibleDependencyDir(packageName, pkg.dir),
    )
  }

  return candidates
}

export interface FastPathResolveResult extends ResolveSkillResult {
  kind: 'npm' | 'workspace'
}

function resolveScannedPackageSkill(
  scanned: ReturnType<typeof scanIntentPackageAtRoot>,
  parsedUse: SkillUse,
): FastPathResolveResult | null {
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
    kind: pkg.kind,
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
  fsCache: IntentFsCache,
): FastPathResolveResult | null {
  for (const packageRoot of packageRoots) {
    const scanned = scanIntentPackageAtRoot(packageRoot, {
      fallbackName: parsedUse.packageName,
      fsCache,
      includeSkillMetadata: false,
      projectRoot: cwd,
      skillNameHint: parsedUse.skillName,
    })
    const directResolved = resolveScannedPackageSkill(scanned, parsedUse)
    if (directResolved) return directResolved

    if (scanned.package?.name === parsedUse.packageName) {
      const fallbackScanned = scanIntentPackageAtRoot(packageRoot, {
        fallbackName: parsedUse.packageName,
        fsCache,
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
  context: ProjectContext,
  cwd: string,
  fsCache: IntentFsCache,
): FastPathResolveResult | null {
  if (options.globalOnly) return null
  if (hasYarnPnpFile(cwd) || hasYarnPnpFile(context.workspaceRoot)) return null

  const directResolved = resolveFromPackageRoots(
    getDirectLoadFastPathCandidateDirs(parsedUse.packageName, context, cwd),
    parsedUse,
    cwd,
    fsCache,
  )
  if (directResolved) return directResolved

  if (!context.workspaceRoot) {
    return null
  }

  return resolveFromPackageRoots(
    getWorkspaceLoadFastPathCandidateDirs(
      parsedUse.packageName,
      context,
      fsCache,
    ),
    parsedUse,
    cwd,
    fsCache,
  )
}
