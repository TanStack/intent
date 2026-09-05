import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createIntentFsCache } from './fs-cache.js'
import type { PackageManager } from '../shared/types.js'
import type { IntentFsCache } from './fs-cache.js'

function readPackageManagerField(
  dir: string,
  fsCache: IntentFsCache,
): PackageManager | null {
  if (!existsSync(join(dir, 'package.json'))) return null
  try {
    const parsed = fsCache.readPackageJson(dir)
    if (!parsed) return null

    const value = parsed.packageManager
    if (typeof value !== 'string') return null

    if (value.startsWith('pnpm@')) return 'pnpm'
    if (value.startsWith('yarn@')) return 'yarn'
    if (value.startsWith('bun@')) return 'bun'
    if (value.startsWith('npm@')) return 'npm'
  } catch {
    return null
  }

  return null
}

function detectPackageManagerInDir(
  dir: string,
  fsCache: IntentFsCache,
): PackageManager | null {
  const packageManager = readPackageManagerField(dir, fsCache)
  if (packageManager) return packageManager

  if (existsSync(join(dir, '.pnp.cjs')) || existsSync(join(dir, '.pnp.js'))) {
    return 'yarn'
  }
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) {
    return 'bun'
  }
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'

  return null
}

export function detectPackageManager(
  cwd = process.cwd(),
  extraDirs: Array<string | null | undefined> = [],
  fsCache = createIntentFsCache(),
): PackageManager {
  const seen = new Set<string>()
  const startDirs = [cwd, ...extraDirs].filter((dir): dir is string =>
    Boolean(dir),
  )

  for (const startDir of startDirs) {
    let dir = resolve(startDir)

    while (!seen.has(dir)) {
      seen.add(dir)

      const packageManager = detectPackageManagerInDir(dir, fsCache)
      if (packageManager) return packageManager

      const next = dirname(dir)
      if (next === dir) break
      dir = next
    }
  }

  return 'unknown'
}
