import { getIntentCatalogContext } from '../catalog.js'

export interface CatalogCommandOptions {
  json?: boolean
  refresh?: boolean
}

export async function runCatalogCommand(
  options: CatalogCommandOptions,
): Promise<void> {
  const result = await getIntentCatalogContext({
    cwd: process.cwd(),
    refresh: options.refresh,
  })
  const diagnostics = result.diagnostics
  const output = {
    cacheStatus: result.cacheStatus,
    context: result.context,
    durationMs: diagnostics.durationMs,
    packageCount: diagnostics.packageCount,
    packageJsonReadCount: diagnostics.discoveryPackageJsonReadCount,
    skillCount: diagnostics.skillCount,
    sizeBytes: diagnostics.sizeBytes,
  }

  console.error(
    `[intent catalog] ${output.cacheStatus}; ${output.skillCount} skills; ${output.sizeBytes} bytes; ${output.durationMs.toFixed(1)}ms; packageJsonReadCount=${output.packageJsonReadCount}`,
  )
  console.log(options.json ? JSON.stringify(output) : result.context)
}
