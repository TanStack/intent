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
    'cold catalogue generation',
    async () => {
      await runner.run(['catalog', '--json', '--refresh'])
    },
    createBenchOptions(setup, teardown),
  )

  bench(
    'warm cached catalogue retrieval',
    async () => {
      await runner.run(['catalog', '--json'])
    },
    createBenchOptions(setup, teardown),
  )
})
