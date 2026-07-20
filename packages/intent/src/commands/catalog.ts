import { getIntentCatalogContext } from '../catalog.js'

export interface CatalogCommandOptions {
  json?: boolean
  refresh?: boolean
}

export async function runCatalogCommand(
  options: CatalogCommandOptions = {},
): Promise<void> {
  const result = await getIntentCatalogContext({
    cwd: process.cwd(),
    refresh: options.refresh,
  })
  if (!options.json) {
    console.log(result.context)
    return
  }

  console.log(
    JSON.stringify({
      cacheStatus: result.cacheStatus,
      context: result.context,
    }),
  )
}
