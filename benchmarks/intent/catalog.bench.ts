import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createCliRunner,
  createConsoleSilencer,
  createTempDir,
  writeFile,
  writeJson,
  writePackage,
} from './helpers.js'

const consoleSilencer = createConsoleSilencer()
const root = createTempDir('catalog')
const runner = createCliRunner({ cwd: root })
let getIntentCatalogContext: (options: {
  cwd: string
  refresh?: boolean
}) => Promise<unknown>

beforeAll(async () => {
  consoleSilencer.silence()
  writeJson(join(root, 'package.json'), {
    name: 'intent-catalog-benchmark',
    private: true,
    intent: { skills: ['@bench/*'] },
    dependencies: { '@bench/query': '1.0.0' },
  })
  writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')
  writePackage(join(root, 'node_modules'), '@bench/query', '1.0.0', {
    skills: ['queries', 'mutations', 'invalidation'],
  })
  await runner.setup()
  const catalog = await import('../../packages/intent/dist/catalog.mjs')
  getIntentCatalogContext = catalog.getIntentCatalogContext
})

afterAll(() => {
  runner.teardown()
  rmSync(root, { recursive: true, force: true })
  consoleSilencer.restore()
})

describe('intent catalog', () => {
  bench('cold catalogue generation through API', async () => {
    await getIntentCatalogContext({ cwd: root, refresh: true })
  })

  bench('warm cached catalogue retrieval through API', async () => {
    await getIntentCatalogContext({ cwd: root })
  })

  bench('warm cached catalogue retrieval through CLI', async () => {
    await runner.run(['catalog', '--json'])
  })
})
