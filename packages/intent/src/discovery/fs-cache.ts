import { join } from 'node:path'
import {
  createFsIdentityCache,
  findSkillFiles as findSkillFilesUncached,
  nodeReadFs,
} from '../shared/utils.js'
import type { ReadFs } from '../shared/utils.js'

type PackageJsonReadResult = {
  packageJson: Record<string, unknown> | null
  error: unknown | null
}

type IntentFsCacheStats = {
  packageJsonReadCount: number
  packageJsonCacheHits: number
}

export type IntentFsCache = {
  readPackageJson: (dir: string) => Record<string, unknown> | null
  readPackageJsonResult: (dir: string) => PackageJsonReadResult
  findSkillFiles: (dir: string) => Array<string>
  getFsIdentity: (path: string) => string
  getStats: () => IntentFsCacheStats
  /**
   * Swap the filesystem used for all reads. Under Yarn PnP the scanner installs
   * Yarn's libzip-patched `fs` here once, so subsequent reads reach files inside
   * `.yarn/cache/*.zip`. The patched `fs` also serves real paths, so it is safe
   * to use for every read after the swap.
   */
  useFs: (fs: ReadFs) => void
  /** The filesystem currently used for reads (patched under Yarn PnP). */
  getReadFs: () => ReadFs
  exists: (path: string) => boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createIntentFsCache(): IntentFsCache {
  const packageJsonCache = new Map<string, PackageJsonReadResult>()
  const skillFilesCache = new Map<string, Array<string>>()
  let activeFs: ReadFs = nodeReadFs
  const getFsIdentity = createFsIdentityCache(() => activeFs)
  const stats: IntentFsCacheStats = {
    packageJsonReadCount: 0,
    packageJsonCacheHits: 0,
  }

  function readPackageJsonResult(dir: string): PackageJsonReadResult {
    const key = getFsIdentity(dir)
    const cached = packageJsonCache.get(key)
    if (cached) {
      stats.packageJsonCacheHits += 1
      return cached
    }

    stats.packageJsonReadCount += 1
    try {
      const parsed = JSON.parse(
        activeFs.readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as unknown
      const result = {
        packageJson: isRecord(parsed) ? parsed : null,
        error: null,
      }
      packageJsonCache.set(key, result)
      return result
    } catch (error) {
      const result = { packageJson: null, error }
      packageJsonCache.set(key, result)
      return result
    }
  }

  function readPackageJson(dir: string): Record<string, unknown> | null {
    return readPackageJsonResult(dir).packageJson
  }

  function findSkillFiles(dir: string): Array<string> {
    const key = getFsIdentity(dir)
    const cached = skillFilesCache.get(key)
    if (cached) {
      return [...cached]
    }

    const files = findSkillFilesUncached(dir, activeFs)
    skillFilesCache.set(key, files)
    return [...files]
  }

  return {
    readPackageJson,
    readPackageJsonResult,
    findSkillFiles,
    getFsIdentity,
    getStats: () => ({ ...stats }),
    useFs: (fs: ReadFs) => {
      activeFs = fs
    },
    getReadFs: () => activeFs,
    exists: (path: string) => activeFs.existsSync(path),
  }
}
