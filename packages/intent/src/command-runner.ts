import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ScanResult } from './types.js'

type PackageManager = ScanResult['packageManager']

const runnerByPackageManager: Record<PackageManager, string> = {
  bun: 'bunx @tanstack/intent@latest',
  npm: 'npx @tanstack/intent@latest',
  pnpm: 'pnpm dlx @tanstack/intent@latest',
  unknown: 'npx @tanstack/intent@latest',
  yarn: 'yarn dlx @tanstack/intent@latest',
}

export function formatIntentCommand(
  packageManager: PackageManager,
  args: string,
): string {
  const command = runnerByPackageManager[packageManager]
  const trimmedArgs = args.trim()
  return trimmedArgs ? `${command} ${trimmedArgs}` : command
}

export function detectIntentCommandPackageManager(
  cwd = process.cwd(),
): PackageManager {
  let dir = resolve(cwd)

  while (true) {
    const packageManager = readPackageManagerField(dir)
    if (packageManager) return packageManager

    if (existsSync(join(dir, '.pnp.cjs')) || existsSync(join(dir, '.pnp.js'))) {
      return 'yarn'
    }
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (
      existsSync(join(dir, 'bun.lockb')) ||
      existsSync(join(dir, 'bun.lock'))
    ) {
      return 'bun'
    }
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm'

    const next = dirname(dir)
    if (next === dir) return 'unknown'
    dir = next
  }
}

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
