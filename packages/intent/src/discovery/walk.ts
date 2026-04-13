import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listNodeModulesPackageDirs, resolveDepDir, getDeps } from '../utils.js'
import {
  readWorkspacePatterns,
  resolveWorkspacePackages,
} from '../workspace-patterns.js'
import type { IntentPackage } from '../types.js'

type PackageJson = Record<string, unknown>

export interface CreateDependencyWalkerOptions {
  projectRoot: string
  readPkgJson: (dirPath: string) => PackageJson | null
  tryRegister: (dirPath: string, fallbackName: string) => boolean
  packages: Array<IntentPackage>
  warnings: Array<string>
}

export function createDependencyWalker(opts: CreateDependencyWalkerOptions) {
  const walkVisited = new Set<string>()

  function walkDepsOf(
    pkgJson: PackageJson,
    fromDir: string,
    includeDevDeps = false,
  ): void {
    for (const depName of getDeps(pkgJson, includeDevDeps)) {
      const depDir = resolveDepDir(depName, fromDir)
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
    try {
      return JSON.parse(
        readFileSync(join(dirPath, 'package.json'), 'utf8'),
      ) as PackageJson
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        opts.warnings.push(
          `Could not read ${label} package.json at ${dirPath}: ${(err as Error).message}`,
        )
      }
      return null
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
