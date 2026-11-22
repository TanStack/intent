import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createBenchOptions,
  createCliFixture,
  createCliRunner,
  createConsoleSilencer,
  createTempDir,
  writeFile,
  writeJson,
  writePackage,
} from './helpers.ts'

type ListFixture = {
  globalNodeModules: string
  root: string
  runner: ReturnType<typeof createCliRunner>
}

const consoleSilencer = createConsoleSilencer()
let fixture: ListFixture | null = null

function createFixture(): ListFixture {
  const root = createTempDir('list')
  const globalNodeModules = createTempDir('global-node-modules')

  writeJson(join(root, 'package.json'), {
    name: 'intent-list-benchmark',
    private: true,
    workspaces: ['packages/*'],
    dependencies: {
      '@bench/root-direct': '1.0.0',
      '@bench/wrapper-one': '1.0.0',
    },
    devDependencies: {
      '@bench/dev-helper': '1.0.0',
    },
  })
  writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')

  writeJson(join(root, 'packages', 'app', 'package.json'), {
    name: '@consumer/app',
    version: '1.0.0',
    dependencies: {
      '@bench/root-direct': '1.0.0',
      '@bench/wrapper-one': '1.0.0',
    },
  })

  writeJson(join(root, 'packages', 'tool', 'package.json'), {
    name: '@consumer/tool',
    version: '1.0.0',
    dependencies: {
      '@bench/local-only': '1.0.0',
      '@bench/wrapper-two': '1.0.0',
    },
  })

  writePackage(join(root, 'node_modules'), '@bench/shared-core', '1.4.0', {
    skills: ['shared-core', 'shared-core/caching', 'shared-core/errors'],
  })
  writePackage(join(root, 'node_modules'), '@bench/root-direct', '1.2.0', {
    requires: ['@bench/shared-core'],
    skills: ['root-direct', 'root-direct/cli', 'root-direct/config'],
  })
  writePackage(join(root, 'node_modules'), '@bench/leaf-one', '1.1.0', {
    requires: ['@bench/shared-core'],
    skills: ['leaf-one', 'leaf-one/batching', 'leaf-one/runtime'],
  })
  writePackage(join(root, 'node_modules'), '@bench/leaf-two', '1.0.0', {
    skills: ['leaf-two', 'leaf-two/streaming', 'leaf-two/debugging'],
    useDerivedIntent: true,
  })
  writePackage(join(root, 'node_modules'), '@bench/local-only', '1.0.0', {
    skills: ['local-only', 'local-only/testing'],
  })
  writePackage(join(root, 'node_modules'), '@bench/broken-skill', '1.0.0', {
    brokenIntent: true,
    skills: ['broken-skill'],
  })
  writePackage(join(root, 'node_modules'), '@bench/wrapper-one', '1.0.0', {
    dependencies: {
      '@bench/leaf-one': '1.1.0',
      '@bench/shared-core': '1.4.0',
    },
  })
  writePackage(join(root, 'node_modules'), '@bench/wrapper-two', '1.0.0', {
    dependencies: {
      '@bench/leaf-two': '1.0.0',
    },
  })
  writePackage(join(root, 'node_modules'), '@bench/dev-helper', '1.0.0', {
    dependencies: {
      '@bench/local-only': '1.0.0',
      '@bench/wrapper-two': '1.0.0',
    },
  })

  writePackage(
    join(root, 'packages', 'tool', 'node_modules'),
    '@bench/workspace-addon',
    '1.0.0',
    {
      skills: ['workspace-addon', 'workspace-addon/runtime'],
    },
  )

  writePackage(globalNodeModules, '@bench/global-only', '2.0.0', {
    skills: ['global-only', 'global-only/setup', 'global-only/migrations'],
  })
  writePackage(globalNodeModules, '@bench/shared-core', '9.9.0', {
    skills: ['shared-core', 'shared-core/caching'],
  })

  return {
    root,
    globalNodeModules,
    runner: createCliRunner({ cwd: root, globalNodeModules }),
  }
}

function getFixture(): ListFixture {
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
    rmSync(fixture.globalNodeModules, { recursive: true, force: true })
    fixture = null
  }

  consoleSilencer.restore()
}

describe('intent list', () => {
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'scans a consumer workspace',
    async () => {
      const state = getFixture()
      for (let index = 0; index < 3; index++) {
        await state.runner.run(['list', '--json'])
      }
    },
    createBenchOptions(setup, teardown),
  )
})

type ListOutput = {
  packages: Array<{ name: string }>
}

const allowlistedScopes = 30

const manyDependencies = createCliFixture(
  'list-many-dependencies',
  async (root, capture) => {
    const dependencies: Record<string, string> = {}
    for (let index = 0; index < allowlistedScopes * 10; index++) {
      const allowlisted = index % 10 === 0
      const name = allowlisted
        ? `@bench-scope-${index / 10}/library`
        : `plain-${index}`
      dependencies[name] = '1.0.0'
      writePackage(join(root, 'node_modules'), name, '1.0.0', {
        skills: allowlisted ? ['core', 'core/setup'] : undefined,
      })
    }
    writeJson(join(root, 'package.json'), {
      name: 'intent-list-many-dependencies-benchmark',
      private: true,
      dependencies,
      intent: {
        skills: Array.from(
          { length: allowlistedScopes },
          (_, scope) => `@bench-scope-${scope}/*`,
        ),
      },
    })

    const output = JSON.parse(await capture(['list', '--json'])) as ListOutput
    if (output.packages.length !== allowlistedScopes) {
      throw new Error(`Expected ${allowlistedScopes} listed packages`)
    }
  },
)

describe('intent list with many dependencies', () => {
  beforeAll(manyDependencies.setup)
  afterAll(manyDependencies.teardown)

  bench(
    'scans allowlisted scopes among dependencies without skills',
    async () => {
      await manyDependencies.run(['list', '--json'])
    },
    createBenchOptions(manyDependencies.setup, manyDependencies.teardown),
  )
})

const nestedWrappers = 40

const nestedNodeModules = createCliFixture(
  'list-nested-node-modules',
  async (root, capture) => {
    writeJson(join(root, 'package.json'), {
      name: 'intent-list-nested-node-modules-benchmark',
      private: true,
    })

    for (let index = 0; index < nestedWrappers; index++) {
      const wrapperRoot = join(root, 'node_modules', `wrapper-${index}`)
      writePackage(join(root, 'node_modules'), `wrapper-${index}`, '1.0.0', {})
      writePackage(join(root, 'store'), `@bench/nested-${index}`, '1.0.0', {
        skills: [`nested-${index}`],
      })
      writePackage(
        join(wrapperRoot, 'src', 'node_modules'),
        `@bench/source-tree-${index}`,
        '1.0.0',
        { skills: [`source-tree-${index}`] },
      )

      mkdirSync(join(wrapperRoot, 'node_modules', '@bench'), {
        recursive: true,
      })
      symlinkSync(
        join(root, 'store', '@bench', `nested-${index}`),
        join(wrapperRoot, 'node_modules', '@bench', `nested-${index}`),
        'dir',
      )
      symlinkSync(
        join(root, 'node_modules'),
        join(wrapperRoot, 'node_modules', 'loop'),
        'dir',
      )
    }

    const output = JSON.parse(await capture(['list', '--json'])) as ListOutput
    if (
      output.packages.length !== nestedWrappers ||
      output.packages.some((pkg) => !pkg.name.startsWith('@bench/nested-'))
    ) {
      throw new Error(`Expected ${nestedWrappers} nested packages`)
    }
  },
)

describe('intent list through nested node_modules', () => {
  beforeAll(nestedNodeModules.setup)
  afterAll(nestedNodeModules.teardown)

  bench(
    'discovers symlinked nested packages without crawling loops or source trees',
    async () => {
      await nestedNodeModules.run(['list', '--json'])
    },
    createBenchOptions(nestedNodeModules.setup, nestedNodeModules.teardown),
  )
})
