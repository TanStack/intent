import { join } from 'node:path'
import { createIntentFsCache } from '../discovery/fs-cache.js'

/**
 * Reads a project policy manifest, returning null only when the file is absent.
 * Unreadable or invalid manifests throw so failures cannot remove restrictions.
 */
export function readPackageJson(
  dir: string,
  fsCache = createIntentFsCache(),
): Record<string, unknown> | null {
  const filePath = join(dir, 'package.json')
  const { packageJson, error } = fsCache.readPackageJsonResult(dir)
  if (error instanceof SyntaxError) {
    throw new Error(
      `Failed to parse Intent policy from ${filePath}: invalid JSON.`,
    )
  }
  if (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      !fsCache.getReadFs().lstatSync(filePath, { throwIfNoEntry: false })
    ) {
      return null
    }
    throw new Error(
      `Failed to read Intent policy from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!packageJson) {
    throw new Error(
      `Invalid Intent policy manifest ${filePath}: expected a JSON object.`,
    )
  }

  return packageJson
}
