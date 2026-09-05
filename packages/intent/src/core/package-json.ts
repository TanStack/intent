import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readPackageJson(dir: string): Record<string, unknown> | null {
  const filePath = join(dir, 'package.json')
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === 'ENOENT' &&
      !lstatSync(filePath, { throwIfNoEntry: false })
    ) {
      return null
    }
    throw new Error(
      `Failed to read Intent policy from ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(
      `Failed to parse Intent policy from ${filePath}: invalid JSON.`,
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Invalid Intent policy manifest ${filePath}: expected a JSON object.`,
    )
  }

  return parsed as Record<string, unknown>
}
