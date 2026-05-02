import { fail } from '../cli-error.js'
import { coreOptionsFromGlobalFlags } from '../cli-support.js'
import { IntentCoreError, loadIntentSkill } from '../core.js'
import type { GlobalScanFlags } from '../cli-support.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface LoadCommandOptions extends GlobalScanFlags {
  json?: boolean
  path?: boolean
}

export async function runLoadCommand(
  use: string | undefined,
  options: LoadCommandOptions,
  _scanIntentsOrFail?: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  if (!use) {
    fail('Missing skill use. Expected: intent load <package>#<skill>')
  }

  if (options.json && options.path) {
    fail('Use either --json or --path, not both.')
  }

  let loaded: ReturnType<typeof loadIntentSkill>
  try {
    loaded = loadIntentSkill(use, coreOptionsFromGlobalFlags(options))
  } catch (err) {
    if (err instanceof IntentCoreError) {
      fail(err.message)
    }
    throw err
  }

  if (options.path) {
    console.log(loaded.path)
    for (const warning of loaded.warnings) {
      console.error(`Warning: ${warning}`)
    }
    return
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          package: loaded.packageName,
          skill: loaded.skillName,
          path: loaded.path,
          packageRoot: loaded.packageRoot,
          source: loaded.source,
          version: loaded.version,
          content: loaded.content,
          warnings: loaded.warnings,
        },
        null,
        2,
      ),
    )
    return
  }

  process.stdout.write(loaded.content)

  for (const warning of loaded.warnings) {
    console.error(`Warning: ${warning}`)
  }
}
