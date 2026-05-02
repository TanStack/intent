import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
  } catch {
    return null
  }
}
