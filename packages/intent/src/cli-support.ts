import { existsSync, readFileSync } from 'node:fs'
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

export interface StaleTargetResult {
  reports: Array<StalenessReport>
  workflowAdvisories: Array<string>
}

const INTENT_CHECK_SKILLS_WORKFLOW_VERSION = 2

export function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

export function getCheckSkillsWorkflowAdvisories(root: string): Array<string> {
  const workflowPath = join(root, '.github', 'workflows', 'check-skills.yml')
  if (!existsSync(workflowPath)) return []

  let content: string
  try {
    content = readFileSync(workflowPath, 'utf8')
  } catch {
    return []
  }

  const versionMatch = content.match(/intent-workflow-version:\s*(\d+)/)
  const installedVersion = versionMatch ? Number(versionMatch[1]) : 0
  if (installedVersion >= INTENT_CHECK_SKILLS_WORKFLOW_VERSION) return []

  return [
    `Intent workflow update available: run \`npx @tanstack/intent@latest setup\` to refresh ${relative(process.cwd(), workflowPath) || workflowPath}.`,
  ]
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
): Promise<StaleTargetResult> {
  const resolvedRoot = targetDir
    ? resolve(process.cwd(), targetDir)
    : process.cwd()
  const context = resolveProjectContext({
    cwd: process.cwd(),
    targetPath: targetDir,
  })
  const advisoryRoot =
    context.workspaceRoot ?? context.packageRoot ?? resolvedRoot
  const workflowAdvisories = getCheckSkillsWorkflowAdvisories(advisoryRoot)
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
      workflowAdvisories,
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
        workflowAdvisories,
      }
    }
  }

  if (existsSync(join(resolvedRoot, 'skills'))) {
    return {
      reports: [
        await checkStaleness(resolvedRoot, readPackageName(resolvedRoot)),
      ],
      workflowAdvisories,
    }
  }

  const staleResult = await scanIntentsOrFail()
  return {
    reports: await Promise.all(
      staleResult.packages.map((pkg) =>
        checkStaleness(pkg.packageRoot, pkg.name),
      ),
    ),
    workflowAdvisories,
  }
}
