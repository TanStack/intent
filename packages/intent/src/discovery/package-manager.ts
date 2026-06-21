import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { PackageManager } from '../shared/types.js'

function readPackageManagerField(dir: string): PackageManager | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    ) as unknown
    if (!parsed || typeof parsed !== 'object') return null

    const value = (parsed as Record<string, unknown>).packageManager
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

function detectPackageManagerInDir(dir: string): PackageManager | null {
  const packageManager = readPackageManagerField(dir)
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
): PackageManager {
  const seen = new Set<string>()
  const startDirs = [cwd, ...extraDirs].filter((dir): dir is string =>
    Boolean(dir),
  )

  for (const startDir of startDirs) {
    let dir = resolve(startDir)

    while (!seen.has(dir)) {
      seen.add(dir)

      const packageManager = detectPackageManagerInDir(dir)
      if (packageManager) return packageManager

      const next = dirname(dir)
      if (next === dir) break
      dir = next
    }
  }

  return 'unknown'
}
