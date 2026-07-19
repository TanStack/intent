import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createBenchOptions,
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

function createFixture(): void {
  writeJson(join(root, 'package.json'), {
    name: 'intent-catalog-benchmark',
    private: true,
    intent: { skills: ['@bench/*'] },
    dependencies: {
      '@bench/query': '1.0.0',
      '@bench/router': '1.0.0',
    },
  })
  writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')
  writePackage(join(root, 'node_modules'), '@bench/query', '1.0.0', {
    skills: ['queries', 'mutations', 'invalidation'],
  })
  writePackage(join(root, 'node_modules'), '@bench/router', '1.0.0', {
    skills: ['routing', 'loaders', 'search-params'],
  })
}

async function setup(): Promise<void> {
  consoleSilencer.silence()
  createFixture()
  await runner.setup()
  const catalog = await import('../../packages/intent/dist/catalog.mjs')
  getIntentCatalogContext = catalog.getIntentCatalogContext
}

async function teardown(): Promise<void> {
  runner.teardown()
  rmSync(root, { recursive: true, force: true })
  consoleSilencer.restore()
}

describe('intent catalog', () => {
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'cold catalogue generation through CLI',
    async () => {
      await runner.run(['catalog', '--json', '--refresh'])
    },
    createBenchOptions(setup, teardown),
  )

  bench(
    'warm cached catalogue retrieval through CLI',
    async () => {
      await runner.run(['catalog', '--json'])
    },
    createBenchOptions(setup, teardown),
  )

  bench(
    'cold catalogue generation through API',
    async () => {
      await getIntentCatalogContext({ cwd: root, refresh: true })
    },
    createBenchOptions(setup, teardown),
  )

  bench(
    'warm cached catalogue retrieval through API',
    async () => {
      await getIntentCatalogContext({ cwd: root })
    },
    createBenchOptions(setup, teardown),
  )
})
