import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail } from './cli-error.js'
import { resolveProjectContext } from './core/project-context.js'
import type { ScanOptions, ScanResult, StalenessReport } from './types.js'

export { printWarnings } from './cli-output.js'

export interface GlobalScanFlags {
  global?: boolean
  globalOnly?: boolean
}

export function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

export async function scanIntentsOrFail(
  options?: ScanOptions,
): Promise<ScanResult> {
  const { scanForIntents } = await import('./scanner.js')

  try {
    return scanForIntents(undefined, options)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

export function scanOptionsFromGlobalFlags(
  options: GlobalScanFlags,
): ScanOptions {
  if (options.global && options.globalOnly) {
    fail('Use either --global or --global-only, not both.')
  }

  if (options.globalOnly) {
    return { scope: 'global' }
  }

  if (options.global) {
    return { scope: 'local-and-global' }
  }

  return { scope: 'local' }
}

export async function resolveStaleTargets(
  targetDir?: string,
): Promise<{ reports: Array<StalenessReport> }> {
  const resolvedRoot = targetDir
    ? resolve(process.cwd(), targetDir)
    : process.cwd()
  const context = resolveProjectContext({
    cwd: process.cwd(),
    targetPath: targetDir,
  })
  const { buildWorkspaceCoverageSignals, checkStaleness, readPackageName } =
    await import('./staleness.js')
  const isWorkspaceRootTarget =
    context.workspaceRoot !== null && resolvedRoot === context.workspaceRoot

  if (
    context.packageRoot &&
    !isWorkspaceRootTarget &&
    (context.targetSkillsDir !== null || resolvedRoot !== context.workspaceRoot)
  ) {
    return {
      reports: [
        await checkStaleness(
          context.packageRoot,
          readPackageName(context.packageRoot),
          context.workspaceRoot ?? context.packageRoot,
        ),
      ],
    }
  }

  const { findPackagesWithSkills, findWorkspacePackages, findWorkspaceRoot } =
    await import('./workspace-patterns.js')
  const workspaceRoot = findWorkspaceRoot(resolvedRoot)
  if (workspaceRoot) {
    const packageDirsWithSkills = findPackagesWithSkills(workspaceRoot)
    const allPackageDirs = findWorkspacePackages(workspaceRoot)
    const reports = await Promise.all(
      packageDirsWithSkills.map((packageDir) =>
        checkStaleness(packageDir, readPackageName(packageDir), workspaceRoot),
      ),
    )
    const { readIntentArtifacts } = await import('./artifact-coverage.js')
    const artifacts = existsSync(join(workspaceRoot, '_artifacts'))
      ? readIntentArtifacts(workspaceRoot)
      : null
    const coverageSignals = buildWorkspaceCoverageSignals({
      artifactRoot: workspaceRoot,
      artifacts,
      packageDirs: allPackageDirs,
    })
    if (coverageSignals.length > 0) {
      const workspaceReport = reports[0]
      if (workspaceReport) {
        workspaceReport.signals.push(...coverageSignals)
      } else {
        reports.push({
          library: relative(process.cwd(), workspaceRoot) || 'workspace',
          currentVersion: null,
          skillVersion: null,
          versionDrift: null,
          skills: [],
          signals: coverageSignals,
        })
      }
    }

    if (reports.length > 0) {
      return {
        reports,
      }
    }
  }

  if (existsSync(join(resolvedRoot, 'skills'))) {
    return {
      reports: [
        await checkStaleness(resolvedRoot, readPackageName(resolvedRoot)),
      ],
    }
  }

  const staleResult = await scanIntentsOrFail()
  return {
    reports: await Promise.all(
      staleResult.packages.map((pkg) =>
        checkStaleness(pkg.packageRoot, pkg.name),
      ),
    ),
  }
}
