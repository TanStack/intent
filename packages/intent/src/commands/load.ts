import { fail } from '../cli-error.js'
import { coreOptionsFromGlobalFlags, printDebugInfo } from '../cli-support.js'
import {
  IntentCoreError,
  loadIntentSkill,
  resolveIntentSkill,
} from '../core.js'
import type { GlobalScanFlags } from '../cli-support.js'
import type { LoadedIntentSkill, ResolvedIntentSkill } from '../core.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface LoadCommandOptions extends GlobalScanFlags {
  json?: boolean
  path?: boolean
}

function printLoadDebug(loaded: LoadedIntentSkill | ResolvedIntentSkill): void {
  if (!loaded.debug) return

  printDebugInfo('intent load', [
    ['cwd', loaded.debug.cwd],
    ['scope', loaded.debug.scope],
    ['resolution', loaded.debug.resolution],
    ['excludes', loaded.debug.excludes],
    ['package', loaded.debug.packageName],
    ['version', loaded.debug.version],
    ['source', loaded.debug.source],
    ['skill', loaded.debug.skillName],
    ['path', loaded.debug.path],
    ['warnings', loaded.debug.warningCount],
    ['packageJsonReadCount', loaded.debug.scan.packageJsonReadCount],
    ['packageJsonCacheHits', loaded.debug.scan.packageJsonCacheHits],
  ])
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

  const coreOptions = coreOptionsFromGlobalFlags(options)

  if (options.path) {
    let resolved: ResolvedIntentSkill
    try {
      resolved = resolveIntentSkill(use, coreOptions)
    } catch (err) {
      if (err instanceof IntentCoreError) {
        fail(err.message)
      }
      throw err
    }
    printLoadDebug(resolved)

    console.log(resolved.path)
    for (const warning of resolved.warnings) {
      console.error(`Warning: ${warning}`)
    }
    return
  }

  let loaded: LoadedIntentSkill
  try {
    loaded = loadIntentSkill(use, coreOptions)
  } catch (err) {
    if (err instanceof IntentCoreError) {
      fail(err.message)
    }
    throw err
  }
  printLoadDebug(loaded)

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
