import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listNodeModulesPackageDirs, resolveDepDir, getDeps } from '../utils.js'
import {
  readWorkspacePatterns,
  resolveWorkspacePackages,
} from '../workspace-patterns.js'

type PackageJson = Record<string, unknown>

export interface CreateDependencyWalkerOptions {
  projectRoot: string
  readPkgJson: (dirPath: string) => PackageJson | null
  tryRegister: (dirPath: string, fallbackName: string) => boolean
  packages: Array<{ packageRoot: string; name: string }>
  warnings: Array<string>
}

export function createDependencyWalker(opts: CreateDependencyWalkerOptions) {
  const walkVisited = new Set<string>()

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

    for (const depName of getDeps(pkgJson)) {
      const depDir = resolveDepDir(depName, pkgDir)
      if (!depDir || walkVisited.has(depDir)) continue

      opts.tryRegister(depDir, depName)
      walkDeps(depDir, depName)
    }
  }

  function walkKnownPackages(): void {
    for (const pkg of [...opts.packages]) {
      walkDeps(pkg.packageRoot, pkg.name)
    }
  }

  function walkProjectDeps(): void {
    let projectPkg: PackageJson | null = null
    try {
      projectPkg = JSON.parse(
        readFileSync(join(opts.projectRoot, 'package.json'), 'utf8'),
      ) as PackageJson
    } catch (err: unknown) {
      const isNotFound =
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (!isNotFound) {
        opts.warnings.push(
          `Could not read project package.json: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    if (!projectPkg) return
    walkDepsFromPkgJson(projectPkg, opts.projectRoot, true)
  }

  function walkDepsFromPkgJson(
    pkgJson: PackageJson,
    fromDir: string,
    includeDevDeps = false,
  ): void {
    for (const depName of getDeps(pkgJson, includeDevDeps)) {
      const depDir = resolveDepDir(depName, fromDir)
      if (depDir && !walkVisited.has(depDir)) {
        opts.tryRegister(depDir, depName)
        walkDeps(depDir, depName)
      }
    }
  }

  function walkWorkspacePackages(): void {
    const workspacePatterns = readWorkspacePatterns(opts.projectRoot)
    if (!workspacePatterns) return

    for (const wsDir of resolveWorkspacePackages(
      opts.projectRoot,
      workspacePatterns,
    )) {
      const wsNodeModules = join(wsDir, 'node_modules')
      if (existsSync(wsNodeModules)) {
        for (const dirPath of listNodeModulesPackageDirs(wsNodeModules)) {
          opts.tryRegister(dirPath, 'unknown')
        }
      }

      const wsPkg = opts.readPkgJson(wsDir)
      if (wsPkg) {
        walkDepsFromPkgJson(wsPkg, wsDir)
      }
    }
  }

  return {
    walkDeps,
    walkKnownPackages,
    walkProjectDeps,
    walkWorkspacePackages,
  }
}
