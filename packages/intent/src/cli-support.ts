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

function readPackageName(root: string): string {
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      name?: unknown
    }
    return typeof pkgJson.name === 'string'
      ? pkgJson.name
      : relative(process.cwd(), root) || 'unknown'
  } catch {
    return relative(process.cwd(), root) || 'unknown'
  }
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
  const { checkStaleness } = await import('./staleness.js')

  if (
    context.packageRoot &&
    (context.targetSkillsDir !== null || resolvedRoot !== context.workspaceRoot)
  ) {
    return {
      reports: [
        await checkStaleness(
          context.packageRoot,
          readPackageName(context.packageRoot),
        ),
      ],
    }
  }

  if (existsSync(join(resolvedRoot, 'skills'))) {
    return {
      reports: [
        await checkStaleness(resolvedRoot, readPackageName(resolvedRoot)),
      ],
    }
  }

  const { findPackagesWithSkills, findWorkspaceRoot } =
    await import('./workspace-patterns.js')
  const workspaceRoot = findWorkspaceRoot(resolvedRoot)
  if (workspaceRoot) {
    const packageDirs = findPackagesWithSkills(workspaceRoot)
    if (packageDirs.length > 0) {
      return {
        reports: await Promise.all(
          packageDirs.map((packageDir) =>
            checkStaleness(packageDir, readPackageName(packageDir)),
          ),
        ),
      }
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
