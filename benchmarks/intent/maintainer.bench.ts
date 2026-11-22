import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createCliFixture,
  createSlowBenchOptions,
  createTempDir,
  git,
  writeExampleLibrary,
  writeExampleSkill,
  writeFile,
  writeJson,
  writeSkill,
} from './helpers.ts'

const cliPath = fileURLToPath(
  new URL('../../packages/intent/dist/cli.mjs', import.meta.url),
)

for (const count of [20, 200]) {
  describe(`maintainer setup with ${count} existing skills`, () => {
    let root: string | undefined
    function setup() {
      if (root) return
      root = createTempDir('maintainer-setup')
      writeJson(join(root, 'package.json'), {
        name: '@bench/library',
        version: '1.0.0',
      })
      writeFile(
        join(root, '.github/workflows/check-skills.yml'),
        '# Existing repository workflow\n',
      )
      for (let index = 0; index < count; index++) {
        writeSkill(root, `task-${index}`, {
          description: `Use for task ${index}.`,
          sources: ['package.json'],
        })
      }
      execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
        cwd: root,
      })
    }
    function teardown() {
      if (root) rmSync(root, { recursive: true, force: true })
      root = undefined
    }
    beforeAll(setup)
    afterAll(teardown)

    bench(
      'registers the complete batch',
      () => {
        setup()
        // Repeat first setup, without including fixture creation or a network lookup.
        for (const path of ['skills/_artifacts', '.intent', 'AGENTS.md']) {
          rmSync(join(root!, path), { recursive: true, force: true })
        }
        const result = spawnSync(
          process.execPath,
          [cliPath, 'maintainer', 'setup'],
          {
            cwd: root,
            encoding: 'utf8',
            timeout: 30_000,
          },
        )
        if (
          result.status !== 0 ||
          result.stdout.split('Registered skills/').length - 1 !== count
        ) {
          throw new Error(
            `Incomplete registration: ${result.stdout}${result.stderr}`,
          )
        }
      },
      { warmupIterations: 3, time: 3_000, setup, teardown },
    )
  })
}

const reviewedRepository = createCliFixture(
  'maintainer-reviewed',
  async (root, capture) => {
    writeExampleLibrary(root, '@bench/client')
    writeFile(
      join(root, '.github/workflows/check-skills.yml'),
      '# Existing repository workflow\n',
    )
    for (let index = 0; index < 20; index++) {
      writeExampleSkill(root, `task-${index}`, '@bench/client', index + 1)
    }
    git(root, 'init', '-q')
    await capture([
      'maintainer',
      'setup',
      '--distribution',
      'repo',
      '--skill',
      'task-0',
    ])
    for (const [record, placeholder, authored] of [
      ['domain_map.yaml', 'tasks: []', 'tasks: ["Request the resource"]'],
      ['skill_spec.md', '<!-- intent:needs-authoring -->', 'Authored.'],
    ] as const) {
      const path = join(root, 'skills', '_artifacts', record)
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replaceAll(placeholder, authored),
      )
    }
    await capture(['maintainer', 'sync'])
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'fixture')
    await capture(['maintainer', 'review', '--unchanged', 'Matches source.'])

    const synchronized = await capture(['maintainer', 'sync'])
    if (!synchronized.startsWith('Nothing to synchronize.')) {
      throw new Error(`Unexpected maintainer sync output: ${synchronized}`)
    }
  },
)

describe('maintainer workflow on a reviewed repository', () => {
  beforeAll(reviewedRepository.setup)
  afterAll(reviewedRepository.teardown)

  bench(
    'checks skills, typed examples, and reviews',
    async () => {
      await reviewedRepository.run(['maintainer', 'check'])
    },
    createSlowBenchOptions(
      reviewedRepository.setup,
      reviewedRepository.teardown,
    ),
  )

  bench(
    'plans an unchanged repository distribution',
    async () => {
      await reviewedRepository.run(['maintainer', 'sync'])
    },
    createSlowBenchOptions(
      reviewedRepository.setup,
      reviewedRepository.teardown,
    ),
  )
})
