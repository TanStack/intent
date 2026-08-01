import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PackageManager } from './types.js'

export function packageVersionToPin(version: string): string {
  if (version.includes('-')) return version

  const [major, minor] = version.split('.')
  if (!major || !minor) throw new Error(`Invalid package version: ${version}`)
  return `${major}.${minor}`
}

function resolveIntentPackagePin(startDir: string): string {
  let dir = startDir

  for (let limit = 0; limit < 10; limit++) {
    try {
      const packageJson = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { name?: unknown; version?: unknown }
      if (
        packageJson.name === '@tanstack/intent' &&
        typeof packageJson.version === 'string'
      ) {
        return packageVersionToPin(packageJson.version)
      }
    } catch {}

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return 'latest'
}

const intentPackagePin = resolveIntentPackagePin(
  dirname(fileURLToPath(import.meta.url)),
)

const runnerByPackageManager: Record<PackageManager, string> = {
  bun: `bunx @tanstack/intent@${intentPackagePin}`,
  npm: `npx @tanstack/intent@${intentPackagePin}`,
  pnpm: `pnpm dlx @tanstack/intent@${intentPackagePin}`,
  unknown: `npx @tanstack/intent@${intentPackagePin}`,
  yarn: `yarn dlx @tanstack/intent@${intentPackagePin}`,
}

export function formatIntentCommand(
  packageManager: PackageManager,
  args: string,
  options: { local?: boolean } = {},
): string {
  const command = options.local
    ? 'npx @tanstack/intent'
    : runnerByPackageManager[packageManager]
  const trimmedArgs = args.trim()
  return trimmedArgs ? `${command} ${trimmedArgs}` : command
}
