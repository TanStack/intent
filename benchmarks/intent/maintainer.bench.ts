import { execFileSync, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import { createTempDir, writeFile, writeJson, writeSkill } from './helpers.ts'

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
