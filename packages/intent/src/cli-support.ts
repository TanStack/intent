import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail } from './cli-error.js'
import type { ScanResult, StalenessReport } from './types.js'

export function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

export async function scanIntentsOrFail(): Promise<ScanResult> {
  const { scanForIntents } = await import('./scanner.js')

  try {
    return scanForIntents()
  } catch (err) {
    fail((err as Error).message)
  }
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
    ? join(process.cwd(), targetDir)
    : process.cwd()
  const { checkStaleness } = await import('./staleness.js')

  if (existsSync(join(resolvedRoot, 'skills'))) {
    return {
      reports: [
        await checkStaleness(resolvedRoot, readPackageName(resolvedRoot)),
      ],
    }
  }

  const { findPackagesWithSkills, findWorkspaceRoot } =
    await import('./setup.js')
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
