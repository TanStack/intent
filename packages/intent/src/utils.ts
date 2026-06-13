import { execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Dirent } from 'node:fs'

/**
 * The subset of `node:fs` the scanner reads through. Under Yarn PnP this is
 * swapped for Yarn's libzip-patched `fs` so reads can reach files inside
 * `.yarn/cache/*.zip` (see scanner `loadPnpApi`). The static `node:fs` named
 * imports cannot be used directly for that, because their bindings are captured
 * before Yarn's `setup()` patches the CommonJS `fs` module.
 */
export interface ReadFs {
  existsSync: typeof existsSync
  lstatSync: typeof lstatSync
  readFileSync: typeof readFileSync
  readdirSync: typeof readdirSync
  realpathSync: typeof realpathSync
  /**
   * Optional low-level read primitives. When present (always on `node:fs` and
   * Yarn's libzip-patched module) `parseFrontmatter` reads only the leading
   * region of a file instead of its whole body.
   */
  openSync?: typeof openSync
  readSync?: typeof readSync
  closeSync?: typeof closeSync
}

export const nodeReadFs: ReadFs = {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  openSync,
  readSync,
  closeSync,
}

/**
 * Convert a path to use forward slashes (for cross-platform consistency).
 */
export function toPosixPath(p: string): string {
  return p.split(sep).join('/')
}

export function createFsIdentityCache(
  getFs: () => ReadFs = () => nodeReadFs,
): (path: string) => string {
  const cache = new Map<string, string>()

  return (path: string): string => {
    const resolved = resolve(path)
    const cached = cache.get(resolved)
    if (cached) return cached

    const fs = getFs()
    let identity: string
    try {
      identity = fs.lstatSync(resolved).isSymbolicLink()
        ? fs.realpathSync(resolved)
        : resolved
    } catch {
      identity = resolved
    }

    cache.set(resolved, identity)
    return identity
  }
}

/**
 * Recursively find all SKILL.md files under a directory.
 */
export function findSkillFiles(
  dir: string,
  fs: ReadFs = nodeReadFs,
): Array<string> {
  const files: Array<string> = []
  collectSkillFiles(dir, fs, files)
  return files
}

function collectSkillFiles(
  dir: string,
  fs: ReadFs,
  files: Array<string>,
): void {
  let entries: Array<Dirent<string>>
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSkillFiles(fullPath, fs, files)
    } else if (entry.name === 'SKILL.md') {
      files.push(fullPath)
    }
  }
}

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
      for (const name of Object.keys(d as Record<string, string>)) {
        deps.add(name)
      }
    }
  }
  return [...deps]
}

export function listNodeModulesPackageDirs(
  nodeModulesDir: string,
): Array<string> {
  let topEntries: Array<Dirent<string>>
  try {
    topEntries = readdirSync(nodeModulesDir, {
      withFileTypes: true,
      encoding: 'utf8',
    })
  } catch {
    return []
  }

  const packageDirs: Array<string> = []

  for (const entry of topEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dirPath = join(nodeModulesDir, entry.name)

    if (entry.name.startsWith('@')) {
      let scopedEntries: Array<Dirent<string>>
      try {
        scopedEntries = readdirSync(dirPath, {
          withFileTypes: true,
          encoding: 'utf8',
        })
      } catch {
        continue
      }

      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        packageDirs.push(join(dirPath, scoped.name))
      }
    } else if (!entry.name.startsWith('.')) {
      packageDirs.push(dirPath)
    }
  }

  return packageDirs
}

export function listNestedNodeModulesPackageDirs(
  nodeModulesDir: string,
  getFsIdentity = createFsIdentityCache(),
): Array<string> {
  const packageDirs: Array<string> = []
  const visitedNodeModulesDirs = new Set<string>()
  const visitedPackageDirs = new Set<string>()

  function readDir(dir: string): Array<Dirent<string>> {
    try {
      return readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return []
    }
  }

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

    for (const entry of readDir(dir)) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const dirPath = join(dir, entry.name)

      if (entry.name.startsWith('@')) {
        for (const scoped of readDir(dirPath)) {
          if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
          addPackageDir(join(dirPath, scoped.name))
        }
        continue
      }

      if (!entry.name.startsWith('.')) addPackageDir(dirPath)
    }
  }

  scanNodeModulesDir(nodeModulesDir)
  return packageDirs
}

export function detectGlobalNodeModules(packageManager: string): {
  path: string | null
  source?: string
} {
  const envPath = process.env.INTENT_GLOBAL_NODE_MODULES?.trim()
  if (envPath) {
    return {
      path: envPath,
      source: 'INTENT_GLOBAL_NODE_MODULES',
    }
  }

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
 * Resolve the directory of a dependency by name. Tries createRequire first
 * (handles pnpm symlinks), then falls back to walking up node_modules
 * directories (handles packages with export maps that block ./package.json).
 */
/**
 * `createRequire` builds a full module-resolution context; constructing it is
 * non-trivial and `resolveDepDir` is called once per dependency, often many
 * times from the same `parentDir` (every sibling dep of one package). Cache the
 * require function by its base `package.json` path. `req.resolve` still hits the
 * live filesystem on each call, so cached entries never go stale.
 */
const requireForBaseCache = new Map<string, ReturnType<typeof createRequire>>()

function getRequireForBase(
  basePackageJson: string,
): ReturnType<typeof createRequire> {
  let req = requireForBaseCache.get(basePackageJson)
  if (!req) {
    req = createRequire(basePackageJson)
    requireForBaseCache.set(basePackageJson, req)
  }
  return req
}

export function resolveDepDir(
  depName: string,
  parentDir: string,
): string | null {
  // Try createRequire — works for most packages including pnpm virtual store
  try {
    const req = getRequireForBase(join(parentDir, 'package.json'))
    const pkgJsonPath = req.resolve(join(depName, 'package.json'))
    return dirname(pkgJsonPath)
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined
    if (
      code &&
      code !== 'MODULE_NOT_FOUND' &&
      code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED'
    ) {
      console.warn(
        `Warning: could not resolve ${depName} from ${parentDir}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Fallback: walk up from parentDir checking node_modules/<depName>.
  // Handles packages with exports maps that don't expose ./package.json.
  let dir = parentDir
  let prev: string | undefined
  while (dir !== prev) {
    const candidate = join(dir, 'node_modules', depName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    prev = dir
    dir = dirname(dir)
  }

  return null
}

/**
 * Parse YAML frontmatter from a file. Returns null if no frontmatter or on error.
 */
export function parseFrontmatter(
  filePath: string,
  fs: ReadFs = nodeReadFs,
): Record<string, unknown> | null {
  const content = readFrontmatterRegion(filePath, fs)
  if (content === null) return null
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return null
  try {
    return parseYaml(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Max bytes read when probing a file's leading frontmatter region. */
const FRONTMATTER_READ_LIMIT = 16 * 1024
/** Reused across calls; safe because reads are synchronous and single-threaded. */
const frontmatterBuffer = Buffer.allocUnsafe(FRONTMATTER_READ_LIMIT)

/**
 * Read just the leading region of a file, enough to cover its frontmatter,
 * instead of its whole body. Falls back to a full read when the bounded read
 * primitives are unavailable or the frontmatter exceeds the probe limit.
 */
function readFrontmatterRegion(filePath: string, fs: ReadFs): string | null {
  if (fs.openSync && fs.readSync && fs.closeSync) {
    let region: string | null = null
    let truncated = false
    let fd: number
    try {
      fd = fs.openSync(filePath, 'r')
    } catch {
      return null
    }
    try {
      const bytesRead = fs.readSync(
        fd,
        frontmatterBuffer,
        0,
        FRONTMATTER_READ_LIMIT,
        0,
      )
      region = frontmatterBuffer.toString('utf8', 0, bytesRead)
      // A full buffer means the file may extend past the probe window; only
      // trust the bounded read when it captured the closing fence.
      truncated =
        bytesRead === FRONTMATTER_READ_LIMIT &&
        !/\r?\n---/.test(region.slice(3))
    } finally {
      fs.closeSync(fd)
    }
    if (!truncated) return region
  }

  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}
