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
  writeSkill,
} from './helpers.js'

type StaleFixture = {
  root: string
  runner: ReturnType<typeof createCliRunner>
}

const consoleSilencer = createConsoleSilencer()
let fixture: StaleFixture | null = null

function createFixture(): StaleFixture {
  const root = createTempDir('stale')

  writeJson(join(root, 'package.json'), {
    name: 'intent-stale-benchmark',
    private: true,
    workspaces: ['packages/*'],
  })
  writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")

  writeStalePackage(root, {
    name: '@bench/alpha',
    packageDir: 'alpha',
    packageVersion: '3.2.0',
    skillVersion: '3.1.0',
    skills: ['alpha/core', 'alpha/cache', 'alpha/streaming', 'alpha/runtime'],
  })
  writeStalePackage(root, {
    name: '@bench/beta',
    packageDir: 'beta',
    packageVersion: '2.4.2',
    skillVersion: '2.4.0',
    skills: ['beta/core', 'beta/forms', 'beta/mutations', 'beta/testing'],
  })
  writeStalePackage(root, {
    name: '@bench/gamma',
    packageDir: 'gamma',
    packageVersion: '1.5.0',
    skillVersion: '1.5.0',
    skills: ['gamma/core', 'gamma/queries', 'gamma/cache', 'gamma/offline'],
  })
  writeStalePackage(root, {
    name: '@bench/delta',
    packageDir: 'delta',
    packageVersion: '5.0.1',
    skillVersion: '5.0.0',
    skills: ['delta/core', 'delta/commands', 'delta/migrations', 'delta/docs'],
  })

  return {
    root,
    runner: createCliRunner({ cwd: root }),
  }
}

function writeStalePackage(
  root: string,
  options: {
    name: string
    packageDir: string
    packageVersion: string
    skillVersion: string
    skills: Array<string>
  },
): void {
  const packageRoot = join(root, 'packages', options.packageDir)

  writeJson(join(packageRoot, 'package.json'), {
    name: options.name,
    version: options.packageVersion,
  })

  const syncState: {
    library_version: string
    skills: Record<string, { sources_sha: Record<string, string> }>
  } = {
    library_version: options.skillVersion,
    skills: {},
  }

  for (const skill of options.skills) {
    const sources = [
      `docs/${skill.replace(/\//g, '-')}.md`,
      'docs/shared-guide.md',
    ]

    writeSkill(packageRoot, skill, {
      description: `${skill} maintenance guide`,
      bodyLines: 16,
      libraryVersion: options.skillVersion,
      sources,
    })

    syncState.skills[skill] = {
      sources_sha: {
        [sources[0]!]: 'sha-1',
      },
    }
  }

  writeJson(join(packageRoot, 'skills', 'sync-state.json'), syncState)
}

function getFixture(): StaleFixture {
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

describe('intent stale', () => {
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'reports workspace drift',
    async () => {
      const state = getFixture()
      for (let index = 0; index < 3; index++) {
        await state.runner.run(['stale', '--json'])
      }
    },
    createBenchOptions(setup, teardown),
  )
})
