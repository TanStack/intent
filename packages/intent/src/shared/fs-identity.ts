import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { resolve } from 'node:path'

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
  fstatSync?: typeof fstatSync
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
  fstatSync,
}

export interface FsIdentityResolver {
  (path: string): string
  /**
   * Record that `realPath` is already an identity (not a symlink), so a later
   * lookup returns it without an `lstat`. Callers use this for directories
   * they have just resolved through `resolveDepDir`.
   */
  prime: (realPath: string) => void
}

export function createFsIdentityCache(
  getFs: () => ReadFs = () => nodeReadFs,
): FsIdentityResolver {
  const cache = new Map<string, string>()

  const getIdentity = ((path: string): string => {
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
  }) as FsIdentityResolver

  getIdentity.prime = (realPath: string): void => {
    const resolved = resolve(realPath)
    if (!cache.has(resolved)) cache.set(resolved, resolved)
  }

  return getIdentity
}
