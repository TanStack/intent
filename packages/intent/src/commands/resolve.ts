import { fail } from '../cli-error.js'
import { scanOptionsFromGlobalFlags } from '../cli-support.js'
import { resolveSkillUse } from '../resolver.js'
import { parseSkillUse } from '../skill-use.js'
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

  parseSkillUse(use)

  const result = await scanIntentsOrFail(scanOptionsFromGlobalFlags(options))
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
