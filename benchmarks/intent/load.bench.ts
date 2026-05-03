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

type LoadFixture = {
  root: string
  runner: ReturnType<typeof createCliRunner>
  workspaceRoot: string
}

const consoleSilencer = createConsoleSilencer()
let fixture: LoadFixture | null = null

function createFixture(): LoadFixture {
  const root = createTempDir('load')
  const workspaceRoot = createTempDir('load-workspace')

  writeLoadProject(root)
  writeLargeWorkspaceProject(workspaceRoot)

  return {
    root,
    runner: createCliRunner({ cwd: root }),
    workspaceRoot,
  }
}

function writeLoadProject(root: string): void {
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

  writeQueryCacheContent(join(root, 'node_modules', '@bench', 'query'))
}

function writeLargeWorkspaceProject(root: string): void {
  writeJson(join(root, 'package.json'), {
    name: 'intent-large-workspace-load-benchmark',
    private: true,
    workspaces: ['packages/*'],
    dependencies: {
      '@bench/query': '1.0.0',
    },
  })
  writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")

  for (let index = 0; index < 120; index++) {
    writeJson(join(root, 'packages', `pkg-${index}`, 'package.json'), {
      name: `@bench/workspace-pkg-${index}`,
      version: '1.0.0',
      dependencies:
        index % 10 === 0
          ? {
              '@bench/query': '1.0.0',
            }
          : undefined,
    })
  }

  writePackage(join(root, 'node_modules'), '@bench/query', '1.0.0', {
    skills: ['query/core', 'query/cache', 'query/testing'],
  })

  writeQueryCacheContent(join(root, 'node_modules', '@bench', 'query'))
}

function writeQueryCacheContent(packageRoot: string): void {
  writeFile(
    join(packageRoot, 'docs', 'cache-guide.md'),
    '# Cache guide\n\nUse the cache workflow for repeated queries.\n',
  )
  writeFile(
    join(packageRoot, 'assets', 'cache.txt'),
    'cache diagram placeholder\n',
  )
  writeFile(
    join(packageRoot, 'skills', 'query', 'cache', 'setup.md'),
    '# Cache setup\n\nConfigure query cache defaults.\n',
  )
  writeFile(
    join(packageRoot, 'skills', 'query', 'cache', 'SKILL.md'),
    [
      '---',
      'name: "query/cache"',
      'description: "query/cache benchmark guidance"',
      'type: "framework"',
      'requires:',
      '  - "query"',
      '---',
      '',
      '# Query Cache',
      '',
      'See [cache guide](../../../docs/cache-guide.md).',
      'Use [local setup](setup.md#configure).',
      '![Cache diagram](../../../assets/cache.txt)',
      '',
      '```md',
      '[ignored code link](setup.md)',
      '```',
      '',
      ...Array.from(
        { length: 20 },
        (_, index) =>
          `${index + 1}. Keep cache guidance aligned with [setup](setup.md) and [guide](../../../docs/cache-guide.md#cache).`,
      ),
      '',
    ].join('\n'),
  )
}

function getFixture(): LoadFixture {
  if (!fixture) {
    consoleSilencer.silence()
    try {
      fixture = createFixture()
    } catch (err) {
      consoleSilencer.restore()
      throw err
    }
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
    rmSync(fixture.workspaceRoot, { recursive: true, force: true })
    fixture = null
  }

  consoleSilencer.restore()
}

async function runInCwd(
  cwd: string,
  callback: () => Promise<void>,
): Promise<void> {
  const previousCwd = process.cwd()
  process.chdir(cwd)
  try {
    await callback()
  } finally {
    process.chdir(previousCwd)
  }
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

  bench(
    'loads direct dependency content as json',
    async () => {
      const state = getFixture()
      for (let index = 0; index < 10; index++) {
        await state.runner.run(['load', '@bench/query#query/cache', '--json'])
      }
    },
    createBenchOptions(setup, teardown),
  )

  bench(
    'loads a direct dependency from a large workspace',
    async () => {
      const state = getFixture()
      await runInCwd(state.workspaceRoot, async () => {
        for (let index = 0; index < 10; index++) {
          await state.runner.run(['load', '@bench/query#query/cache', '--path'])
        }
      })
    },
    createBenchOptions(setup, teardown),
  )
})
