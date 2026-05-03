import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findSkillFiles as findSkillFilesUncached } from './utils.js'

type PackageJsonReadResult = {
  packageJson: Record<string, unknown> | null
  error: unknown | null
}

export type IntentFsCacheStats = {
  packageJsonReadCount: number
  packageJsonCacheHits: number
}

export type IntentFsCache = {
  readPackageJson: (dir: string) => Record<string, unknown> | null
  readPackageJsonResult: (dir: string) => PackageJsonReadResult
  findSkillFiles: (dir: string) => Array<string>
  getStats: () => IntentFsCacheStats
}

function normalizeCacheKey(path: string): string {
  return resolve(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createIntentFsCache(): IntentFsCache {
  const packageJsonCache = new Map<string, PackageJsonReadResult>()
  const skillFilesCache = new Map<string, Array<string>>()
  const stats: IntentFsCacheStats = {
    packageJsonReadCount: 0,
    packageJsonCacheHits: 0,
  }

  function readPackageJsonResult(dir: string): PackageJsonReadResult {
    const key = normalizeCacheKey(dir)
    const cached = packageJsonCache.get(key)
    if (cached) {
      stats.packageJsonCacheHits += 1
      return cached
    }

    stats.packageJsonReadCount += 1
    try {
      const parsed = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
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
    const key = normalizeCacheKey(dir)
    const cached = skillFilesCache.get(key)
    if (cached) {
      return [...cached]
    }

    const files = findSkillFilesUncached(dir)
    skillFilesCache.set(key, files)
    return [...files]
  }

  return {
    readPackageJson,
    readPackageJsonResult,
    findSkillFiles,
    getStats: () => ({ ...stats }),
  }
}
