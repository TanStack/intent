import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail } from '../shared/cli-error.js'
import { resolveProjectContext } from '../core/project-context.js'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import type { IntentCoreOptions } from '../core/index.js'
import type { IntentFsCache } from '../discovery/fs-cache.js'
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

export const INTENT_CHECK_SKILLS_WORKFLOW_VERSION = 4

export function getMetaDir(): string {
  return findMetaDir(dirname(fileURLToPath(import.meta.url)))
}

/**
 * Resolve the package `meta/` directory by walking up from `startDir`.
 *
 * The CLI module sits at `src/commands/` in source but is bundled flat into
 * `dist/` in the published package, so the depth from the module to the
 * package root differs between the two layouts. A hardcoded `..` count is
 * correct for only one of them and breaks `setup` / `meta` / `scaffold` in the
 * other. Walking up to the first `meta/` directory handles both layouts (and
 * symlinked installs such as pnpm) without depending on the build output
 * depth. Falls back to the historical `../../meta` resolution if no `meta/`
 * is found, so behaviour is never worse than before.
 */
export function findMetaDir(startDir: string): string {
  let dir = startDir
  // Sanity cap: a package is never this many dirs deep; the root check below
  // also stops the walk at the filesystem root.
  for (let limit = 0; limit < 10; limit++) {
    const candidate = join(dir, 'meta')
    // Check it's a directory, not just that something named `meta` exists — a
    // stray file named `meta` in an ancestor must not short-circuit the walk.
    if (existsSync(candidate) && statSync(candidate).isDirectory())
      return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(startDir, '..', '..', 'meta')
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
  fsCache?: IntentFsCache,
): Promise<ScanResult> {
  const { scanForPolicedIntents } = await import('../core/source-policy.js')

  try {
    const scanOptions = { ...scanOptionsFromGlobalFlags(coreOptions), fsCache }
    const { scan } = scanForPolicedIntents({
      cwd: process.cwd(),
      scanOptions,
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
  const fsCache = createIntentFsCache()
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
          readPackageName(context.packageRoot, fsCache),
          context.workspaceRoot ?? context.packageRoot,
          { fsCache },
        ),
      ],
      workflowAdvisories,
    }
  }

  const { findWorkspaceRoot, findWorkspacePackages } =
    await import('../setup/workspace-patterns.js')
  const workspaceRoot = findWorkspaceRoot(resolvedRoot)
  if (workspaceRoot) {
    const packageDirs = findWorkspacePackages(workspaceRoot)
    const packageDirsWithSkills = packageDirs.filter(
      (dir) => fsCache.findSkillFiles(join(dir, 'skills')).length > 0,
    )
    const { readIntentArtifacts } =
      await import('../staleness/artifact-coverage.js')
    const artifacts = readIntentArtifacts(workspaceRoot)
    const reports = await Promise.all(
      packageDirsWithSkills.map((packageDir) =>
        checkStaleness(
          packageDir,
          readPackageName(packageDir, fsCache),
          workspaceRoot,
          { fsCache, artifacts },
        ),
      ),
    )
    const coverageSignals = buildWorkspaceCoverageSignals({
      artifactRoot: workspaceRoot,
      artifacts,
      packageDirs,
      fsCache,
    })
    if (coverageSignals.length > 0) {
      reports.push({
        library: relative(process.cwd(), workspaceRoot) || 'workspace',
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
        await checkStaleness(resolvedRoot, undefined, resolvedRoot, {
          fsCache,
        }),
      ],
      workflowAdvisories,
    }
  }

  const staleResult = await scanIntentsOrFail({}, fsCache)
  return {
    reports: await Promise.all(
      staleResult.packages.map((pkg) =>
        checkStaleness(pkg.packageRoot, pkg.name, pkg.packageRoot, { fsCache }),
      ),
    ),
    workflowAdvisories,
  }
}
