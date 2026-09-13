import { detectPackageManager } from '../discovery/package-manager.js'
import type { PackageManager } from './types.js'

export { detectPackageManager as detectIntentCommandPackageManager }

const runnerByPackageManager: Record<PackageManager, string> = {
  bun: 'bunx --no-install --package @tanstack/intent intent',
  npm: 'npm exec --no -- intent',
  pnpm: 'pnpm exec intent',
  unknown: 'npm exec --no -- intent',
  yarn: 'yarn exec intent',
}

/** Use argument arrays for discovered identifiers; strings are trusted templates. */
export function formatIntentCommand(
  packageManager: PackageManager,
  args: string | ReadonlyArray<string>,
): string {
  const command = runnerByPackageManager[packageManager]
  const trimmedArgs =
    typeof args === 'string'
      ? args.trim()
      : args
          .map((arg) => {
            if (
              arg === '' ||
              arg.startsWith('#') ||
              /[^a-zA-Z0-9_./@#-]/.test(arg)
            ) {
              throw new Error(
                'Cannot generate an Intent command: identifiers must contain only letters, numbers, underscores, dots, slashes, @, #, and hyphens, and cannot start with #.',
              )
            }
            return arg
          })
          .join(' ')
  return trimmedArgs ? `${command} ${trimmedArgs}` : command
}
