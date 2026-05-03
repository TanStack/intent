import { join } from 'node:path'
import { resolveDepDir, getDeps } from '../utils.js'
import { findWorkspacePackages } from '../workspace-patterns.js'
import type { IntentFsCache } from '../fs-cache.js'
import type { IntentPackage } from '../types.js'

type PackageJson = Record<string, unknown>

export interface CreateDependencyWalkerOptions {
  fsCache: IntentFsCache
  projectRoot: string
  readPkgJson: (dirPath: string) => PackageJson | null
  scanNodeModulesDir: (nodeModulesDir: string) => void
  tryRegister: (dirPath: string, fallbackName: string) => boolean
  packages: Array<IntentPackage>
  warnings: Array<string>
}

export function createDependencyWalker(opts: CreateDependencyWalkerOptions) {
  const walkVisited = new Set<string>()
  const depDirCache = new Map<string, Map<string, string | null>>()

  function resolveDepDirCached(
    depName: string,
    fromDir: string,
  ): string | null {
    let byDepName = depDirCache.get(fromDir)
    if (!byDepName) {
      byDepName = new Map()
      depDirCache.set(fromDir, byDepName)
    }

    if (!byDepName.has(depName)) {
      byDepName.set(depName, resolveDepDir(depName, fromDir))
    }

    return byDepName.get(depName) ?? null
  }

  function walkDepsOf(
    pkgJson: PackageJson,
    fromDir: string,
    includeDevDeps = false,
  ): void {
    for (const depName of getDeps(pkgJson, includeDevDeps)) {
      const depDir = resolveDepDirCached(depName, fromDir)
      if (!depDir || walkVisited.has(depDir)) continue

      opts.tryRegister(depDir, depName)
      walkDeps(depDir, depName)
    }
  }

  function walkDeps(pkgDir: string, pkgName: string): void {
    if (walkVisited.has(pkgDir)) return
    walkVisited.add(pkgDir)

    const pkgJson = opts.readPkgJson(pkgDir)
    if (!pkgJson) {
      opts.warnings.push(
        `Could not read package.json for ${pkgName} (skipping dependency walk)`,
      )
      return
    }

    walkDepsOf(pkgJson, pkgDir)
  }

  function walkKnownPackages(): void {
    for (const pkg of [...opts.packages]) {
      walkDeps(pkg.packageRoot, pkg.name)
    }
  }

  function walkProjectDeps(): void {
    const projectPkg = readPkgJsonWithWarning(opts.projectRoot, 'project')
    if (!projectPkg) return
    walkDepsOf(projectPkg, opts.projectRoot, true)
  }

  function readPkgJsonWithWarning(
    dirPath: string,
    label: string,
  ): PackageJson | null {
    const result = opts.fsCache.readPackageJsonResult(dirPath)
    if (!result.packageJson) {
      const code = (result.error as NodeJS.ErrnoException | null)?.code
      if (code !== 'ENOENT') {
        opts.warnings.push(
          `Could not read ${label} package.json at ${dirPath}: ${
            result.error instanceof Error
              ? result.error.message
              : 'invalid package.json'
          }`,
        )
      }
      return null
    }

    return result.packageJson
  }

  function walkWorkspacePackages(): void {
    for (const wsDir of findWorkspacePackages(opts.projectRoot)) {
      opts.scanNodeModulesDir(join(wsDir, 'node_modules'))

      const wsPkg = readPkgJsonWithWarning(wsDir, 'workspace')
      if (wsPkg) {
        walkDepsOf(wsPkg, wsDir)
      }
    }
  }

  return {
    walkKnownPackages,
    walkProjectDeps,
    walkWorkspacePackages,
  }
}
