import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createBenchOptions,
  createCliRunner,
  createConsoleSilencer,
  createTempDir,
  writeJson,
  writePackage,
} from './helpers.js'

type LoadFixture = {
  root: string
  runner: ReturnType<typeof createCliRunner>
}

const consoleSilencer = createConsoleSilencer()
let fixture: LoadFixture | null = null

function createFixture(): LoadFixture {
  const root = createTempDir('load')

  writeJson(join(root, 'package.json'), {
    name: 'intent-load-benchmark',
    private: true,
    dependencies: {
      '@bench/query': '1.0.0',
    },
  })

  writePackage(join(root, 'node_modules'), '@bench/query', '1.0.0', {
    skills: ['query/core', 'query/cache', 'query/testing'],
  })

  return {
    root,
    runner: createCliRunner({ cwd: root }),
  }
}

function getFixture(): LoadFixture {
  if (!fixture) {
    consoleSilencer.silence()
    fixture = createFixture()
  }

  return fixture
}

async function setup(): Promise<void> {
  await getFixture().runner.setup()
}

function teardown(): void {
  if (fixture) {
    fixture.runner.teardown()
    rmSync(fixture.root, { recursive: true, force: true })
    fixture = null
  }

  consoleSilencer.restore()
}

describe('intent load', () => {
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'loads a direct dependency skill',
    async () => {
      const state = getFixture()
      for (let index = 0; index < 10; index++) {
        await state.runner.run(['load', '@bench/query#query/cache', '--path'])
      }
    },
    createBenchOptions(setup, teardown),
  )
})
