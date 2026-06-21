import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail } from '../shared/cli-error.js'
import { resolveProjectContext } from '../core/project-context.js'
import type { IntentCoreOptions } from '../core/index.js'
import type {
  ScanOptions,
  ScanResult,
  StalenessReport,
} from '../shared/types.js'

export { printNotices, printWarnings } from '../shared/cli-output.js'

export interface GlobalScanFlags {
  debug?: boolean
  global?: boolean
  globalOnly?: boolean
  notices?: boolean
  noNotices?: boolean
}

export interface StaleTargetResult {
  reports: Array<StalenessReport>
  workflowAdvisories: Array<string>
}

export const INTENT_CHECK_SKILLS_WORKFLOW_VERSION = 3

export function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', '..', 'meta')
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
  coreOptions: IntentCoreOptions = {},
): Promise<ScanResult> {
  const { scanForPolicedIntents } = await import('../core/source-policy.js')

  try {
    const { scan } = scanForPolicedIntents({
      cwd: process.cwd(),
      scanOptions: scanOptionsFromGlobalFlags(coreOptions),
      coreOptions,
    })
    return scan
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

function scanOptionsFromGlobalFlags(options: GlobalScanFlags): ScanOptions {
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

export function coreOptionsFromGlobalFlags(
  options: GlobalScanFlags,
): IntentCoreOptions {
  if (options.global && options.globalOnly) {
    fail('Use either --global or --global-only, not both.')
  }

  return {
    debug: options.debug,
    global: options.global,
    globalOnly: options.globalOnly,
  }
}

export function noticeOptionsFromGlobalFlags(options: GlobalScanFlags): {
  noNotices?: boolean
} {
  return { noNotices: options.noNotices || options.notices === false }
}

function formatDebugValue(value: string | number | Array<string>): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '(none)'
  }

  return String(value)
}

export function printDebugInfo(
  title: string,
  fields: Array<[label: string, value: string | number | Array<string>]>,
): void {
  console.error(`Debug: ${title}`)
  for (const [label, value] of fields) {
    console.error(`  ${label}: ${formatDebugValue(value)}`)
  }
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
    await import('../staleness/index.js')
  const isWorkspaceRootTarget =
    context.workspaceRoot !== null && resolvedRoot === context.workspaceRoot

  if (
    context.packageRoot &&
    !isWorkspaceRootTarget &&
    (context.targetSkillsDir !== null || context.workspaceRoot === null)
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

  const { findWorkspaceRoot, getWorkspaceInfo } =
    await import('../setup/workspace-patterns.js')
  const workspaceRoot = findWorkspaceRoot(resolvedRoot)
  const workspaceInfo = workspaceRoot ? getWorkspaceInfo(workspaceRoot) : null
  if (workspaceInfo) {
    const reports = await Promise.all(
      workspaceInfo.packageDirsWithSkills.map((packageDir) =>
        checkStaleness(
          packageDir,
          readPackageName(packageDir),
          workspaceInfo.root,
        ),
      ),
    )
    const { readIntentArtifacts } =
      await import('../staleness/artifact-coverage.js')
    const artifacts = existsSync(join(workspaceInfo.root, '_artifacts'))
      ? readIntentArtifacts(workspaceInfo.root)
      : null
    const coverageSignals = buildWorkspaceCoverageSignals({
      artifactRoot: workspaceInfo.root,
      artifacts,
      packageDirs: workspaceInfo.packageDirs,
    })
    if (coverageSignals.length > 0) {
      reports.push({
        library: relative(process.cwd(), workspaceInfo.root) || 'workspace',
        currentVersion: null,
        skillVersion: null,
        versionDrift: null,
        skills: [],
        signals: coverageSignals,
      })
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
