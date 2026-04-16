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
