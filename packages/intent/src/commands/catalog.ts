import { performance } from 'node:perf_hooks'
import { listIntentSkills } from '../core/index.js'
import {
  formatSessionCatalogue,
  getSessionCatalogue,
  resolveCatalogueWorkspaceRoot,
} from '../session-catalog.js'

export interface CatalogCommandOptions {
  json?: boolean
  refresh?: boolean
}

export function runCatalogCommand(options: CatalogCommandOptions): void {
  const policyRoot = process.cwd()
  const workspaceRoot = resolveCatalogueWorkspaceRoot(policyRoot)
  const startedAt = performance.now()
  let packageJsonReadCount = 0
  let packageCount = 0
  const result = getSessionCatalogue({
    root: workspaceRoot,
    policyRoot,
    refresh: options.refresh,
    discover: () => {
      const discovered = listIntentSkills({
        audience: 'agent',
        cwd: policyRoot,
        debug: true,
      })
      packageJsonReadCount = discovered.debug?.scan.packageJsonReadCount ?? 0
      packageCount = discovered.packages.length
      return discovered
    },
  })
  const context = formatSessionCatalogue(result.catalogue)
  const durationMs = performance.now() - startedAt
  const output = {
    cacheStatus: result.cacheStatus,
    context,
    durationMs,
    packageCount:
      result.cacheStatus === 'hit'
        ? result.catalogue.packageCount
        : packageCount,
    packageJsonReadCount,
    skillCount: result.catalogue.totalSkillCount,
    sizeBytes: Buffer.byteLength(context),
  }

  console.error(
    `[intent catalog] ${output.cacheStatus}; ${output.skillCount} skills; ${output.sizeBytes} bytes; ${durationMs.toFixed(1)}ms; packageJsonReadCount=${packageJsonReadCount}`,
  )
  console.log(options.json ? JSON.stringify(output) : context)
}
