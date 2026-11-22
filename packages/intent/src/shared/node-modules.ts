import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { normalizeReadlinkTarget } from './paths.js'
import type { Dirent } from 'node:fs'

/**
 * Read dependencies and peerDependencies (and optionally devDependencies) from
 * a parsed package.json object.
 */
export function getDeps(
  pkgJson: Record<string, unknown>,
  includeDevDeps = false,
): Array<string> {
  const deps = new Set<string>()
  const fields = includeDevDeps
    ? ['dependencies', 'devDependencies', 'peerDependencies']
    : ['dependencies', 'peerDependencies']
  for (const field of fields) {
    const d = pkgJson[field]
    if (d && typeof d === 'object') {
      for (const name of Object.keys(d)) {
        deps.add(name)
      }
    }
  }
  return [...deps]
}

function readPackageEntries(dir: string): Array<Dirent<string>> {
  try {
    return readdirSync(dir, { withFileTypes: true, encoding: 'utf8' }).filter(
      (entry) => entry.isDirectory() || entry.isSymbolicLink(),
    )
  } catch {
    return []
  }
}

function forEachPackageDir(
  nodeModulesDir: string,
  visit: (packageDir: string) => void,
): void {
  for (const entry of readPackageEntries(nodeModulesDir)) {
    const dirPath = join(nodeModulesDir, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of readPackageEntries(dirPath)) {
        visit(join(dirPath, scoped.name))
      }
    } else if (!entry.name.startsWith('.')) {
      visit(dirPath)
    }
  }
}

export function listNodeModulesPackageDirs(
  nodeModulesDir: string,
): Array<string> {
  const packageDirs: Array<string> = []
  forEachPackageDir(nodeModulesDir, (dir) => packageDirs.push(dir))
  return packageDirs
}

export function listNestedNodeModulesPackageDirs(
  nodeModulesDir: string,
  getFsIdentity: (path: string) => string,
): Array<string> {
  const packageDirs: Array<string> = []
  const visitedNodeModulesDirs = new Set<string>()
  const visitedPackageDirs = new Set<string>()

  function addPackageDir(packageDir: string): void {
    const key = getFsIdentity(packageDir)
    if (visitedPackageDirs.has(key)) return
    visitedPackageDirs.add(key)

    if (existsSync(join(packageDir, 'package.json'))) {
      packageDirs.push(packageDir)
    }

    scanNodeModulesDir(join(packageDir, 'node_modules'))
  }

  function scanNodeModulesDir(dir: string): void {
    const key = getFsIdentity(dir)
    if (visitedNodeModulesDirs.has(key)) return
    visitedNodeModulesDirs.add(key)
    forEachPackageDir(dir, addPackageDir)
  }

  scanNodeModulesDir(nodeModulesDir)
  return packageDirs
}

const GLOBAL_NODE_MODULES_COMMAND_TIMEOUT_MS = 5_000

export function detectGlobalNodeModules(packageManager: string): {
  path: string | null
  source?: string
} {
  const commands: Array<{
    command: string
    args: Array<string>
    transform?: (output: string) => string
  }> = []

  if (packageManager === 'pnpm') {
    commands.push({ command: 'pnpm', args: ['root', '-g'] })
  }
  if (packageManager === 'yarn') {
    commands.push({
      command: 'yarn',
      args: ['global', 'dir'],
      transform: (output) => join(output, 'node_modules'),
    })
  }
  commands.push({ command: 'npm', args: ['root', '-g'] })

  for (const candidate of commands) {
    try {
      const output = execFileSync(candidate.command, candidate.args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GLOBAL_NODE_MODULES_COMMAND_TIMEOUT_MS,
      }).trim()
      if (!output) continue

      return {
        path: candidate.transform ? candidate.transform(output) : output,
        source: `${candidate.command} ${candidate.args.join(' ')}`,
      }
    } catch {
      continue
    }
  }

  return { path: null }
}

/**
 * Resolve the directory of a dependency by name by walking up from
 * `parentDir` and checking `node_modules/<depName>/package.json` at each
 * ancestor, the same lookup order Node uses. A symlinked match (pnpm's
 * virtual store, workspace links) is collapsed to its real directory so
 * callers see one identity per installed package.
 *
 * This deliberately avoids `createRequire().resolve`: Node's resolver
 * evaluates export maps, reads the nearest package.json, and realpaths every
 * path segment on each call. In a pnpm monorepo that dominated scan time, and
 * the walk below already covers every layout the resolver handled (nested,
 * hoisted, and virtual-store siblings) without executing package code.
 */
export function resolveDepDir(
  depName: string,
  parentDir: string,
  cache: DepDirCache = createDepDirCache(),
): string | null {
  let dir = parentDir
  let prev: string | undefined
  while (dir !== prev) {
    // Node skips ancestors that are themselves node_modules directories
    // (`.../node_modules/node_modules/<dep>` is never a valid location).
    if (basename(dir) !== 'node_modules') {
      const nodeModulesDir = join(dir, 'node_modules')
      if (hasNodeModulesDir(nodeModulesDir, cache)) {
        const candidate = join(nodeModulesDir, depName)
        let resolved = cache.candidates.get(candidate)
        if (resolved === undefined) {
          resolved = resolveCandidateDir(candidate, cache)
          cache.candidates.set(candidate, resolved)
        }
        if (resolved) return resolved
      }
    }
    prev = dir
    dir = dirname(dir)
  }

  return null
}

/**
 * Memo for `resolveDepDir` across one scan. A dependency graph revisits the
 * same `node_modules` directories, candidate paths, and symlink targets many
 * times (every package that depends on `semver` resolves it again), so the
 * cache turns those repeats into map hits. It is never refreshed, so create
 * one per scan rather than sharing it across runs.
 */
export interface DepDirCache {
  /** `existsSync` result per `node_modules` directory. */
  nodeModulesDirs: Map<string, boolean>
  /** Resolution result per `node_modules/<dep>` candidate path. */
  candidates: Map<string, string | null>
  /** Real directory per resolved symlink target, shared by every link to it. */
  targets: Map<string, string | null>
}

export function createDepDirCache(): DepDirCache {
  return {
    nodeModulesDirs: new Map(),
    candidates: new Map(),
    targets: new Map(),
  }
}

function hasNodeModulesDir(dir: string, cache: DepDirCache): boolean {
  let exists = cache.nodeModulesDirs.get(dir)
  if (exists === undefined) {
    exists = existsSync(dir)
    cache.nodeModulesDirs.set(dir, exists)
  }
  return exists
}

/**
 * Resolve one `node_modules/<dep>` candidate to its real directory, or null
 * when no package is installed there.
 *
 * `readlink` is the first probe because it is the cheapest call that also
 * tells symlinks apart: a stat that traverses a pnpm virtual-store link costs
 * several times more than reading the link. Real directories (npm and Yarn
 * hoisting) make it fail with EINVAL and are then checked directly; a missing
 * entry fails with ENOENT.
 */
function resolveCandidateDir(
  candidate: string,
  cache: DepDirCache,
): string | null {
  let target: string | null
  try {
    target = readlinkSync(candidate)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    target = null
  }

  if (target === null) {
    return existsSync(join(candidate, 'package.json')) ? candidate : null
  }

  const resolvedTarget = resolve(
    dirname(candidate),
    normalizeReadlinkTarget(target),
  )
  let real = cache.targets.get(resolvedTarget)
  if (real === undefined) {
    real = existsSync(join(resolvedTarget, 'package.json'))
      ? resolveRealDir(resolvedTarget)
      : null
    cache.targets.set(resolvedTarget, real)
  }
  return real
}

/**
 * Collapse a symlinked directory to its real path with one `lstat` and, only
 * when needed, one native `realpath` call. Non-links are returned as-is.
 */
function resolveRealDir(dir: string): string {
  try {
    return lstatSync(dir).isSymbolicLink() ? realpathSync.native(dir) : dir
  } catch {
    return dir
  }
}
