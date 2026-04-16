import { fail } from '../cli-error.js'
import { resolveSkillUse } from '../resolver.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface ResolveCommandOptions {
  json?: boolean
  global?: boolean
  globalOnly?: boolean
}

export async function runResolveCommand(
  use: string | undefined,
  options: ResolveCommandOptions,
  scanIntentsOrFail: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  if (!use) {
    fail('Missing skill use. Expected: intent resolve <package>#<skill>')
  }

  if (options.global && options.globalOnly) {
    fail('Use either --global or --global-only, not both.')
  }

  const result = await scanIntentsOrFail(getScanOptions(options))
  const resolved = resolveSkillUse(use, result)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          package: resolved.packageName,
          skill: resolved.skillName,
          path: resolved.path,
          source: resolved.source,
          version: resolved.version,
          warnings: resolved.warnings,
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(resolved.path)

  for (const warning of resolved.warnings) {
    console.error(`Warning: ${warning}`)
  }
}

function getScanOptions(options: ResolveCommandOptions): ScanOptions {
  if (options.globalOnly) {
    return { scope: 'global' }
  }

  if (options.global) {
    return { scope: 'local-and-global' }
  }

  return { scope: 'local' }
}
