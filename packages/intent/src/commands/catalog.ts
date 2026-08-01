import { getIntentCatalogContext } from '../catalog.js'
import { fail } from '../shared/cli-error.js'

export interface CatalogCommandOptions {
  global?: boolean
  globalOnly?: boolean
  json?: boolean
  refresh?: boolean
}

export async function runCatalogCommand(
  packageName: string | undefined,
  options: CatalogCommandOptions = {},
): Promise<void> {
  if (options.global || options.globalOnly) {
    fail(
      '`intent catalog` does not support --global or --global-only. Global catalog support is not available.',
    )
  }
  const result = await getIntentCatalogContext({
    cwd: process.cwd(),
    packageName,
    refresh: options.refresh,
  })
  if (!options.json) {
    console.log(result.context)
    return
  }

  console.log(JSON.stringify(result))
}
