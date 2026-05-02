import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveSkillEntry, type ResolveSkillResult } from '../resolver.js'
import { scanIntentPackageAtRoot } from '../scanner.js'
import { resolveWorkspacePackages } from '../workspace-patterns.js'
import { getDeps, resolveDepDir } from '../utils.js'
import { warningMentionsPackage } from './excludes.js'
import { readPackageJson } from './package-json.js'
import { resolveProjectContext } from './project-context.js'
import type { SkillUse } from '../skill-use.js'
import type { IntentCoreOptions } from './types.js'

interface WorkspacePackageInfo {
  dir: string
  name: string | null
  packageJson: Record<string, unknown>
}

function readWorkspacePackageInfos(cwd: string): Array<WorkspacePackageInfo> {
  const context = resolveProjectContext({ cwd })
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

function getLoadFastPathCandidateDirs(packageName: string): Array<string> {
  const cwd = process.cwd()
  const context = resolveProjectContext({ cwd })
  const workspacePackages = readWorkspacePackageInfos(cwd)
  const candidates: Array<string> = []
  const seen = new Set<string>()

  for (const pkg of workspacePackages) {
    if (pkg.name === packageName) {
      addCandidateDir(candidates, seen, pkg.dir)
    }
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

export function resolveSkillUseFastPath(
  parsedUse: SkillUse,
  options: IntentCoreOptions,
): ResolveSkillResult | null {
  if (options.globalOnly) return null

  for (const packageRoot of getLoadFastPathCandidateDirs(
    parsedUse.packageName,
  )) {
    const scanned = scanIntentPackageAtRoot(packageRoot, {
      fallbackName: parsedUse.packageName,
      projectRoot: process.cwd(),
    })
    const pkg = scanned.package
    if (!pkg || pkg.name !== parsedUse.packageName) continue

    const skill = resolveSkillEntry(
      pkg.name,
      parsedUse.skillName,
      pkg.skills,
    ).skill
    if (!skill) continue

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

  return null
}
