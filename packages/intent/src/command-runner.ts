import { detectPackageManager } from './package-manager.js'
import type { PackageManager } from './types.js'

export { detectPackageManager as detectIntentCommandPackageManager }

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
