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

type LockfileFixture = {
  root: string
  runner: ReturnType<typeof createCliRunner>
}

type FixtureOptions = {
  changedSkill?: boolean
  packageCount: number
  skillCount: number
  supportFileCount: number
  supportFileSize: number
}

function createFixture(name: string, options: FixtureOptions): LockfileFixture {
  const root = createTempDir(name)
  const packageNames = Array.from(
    { length: options.packageCount },
    (_, index) => `@bench/lock-${index}`,
  )
  writeJson(join(root, 'package.json'), {
    name: `intent-lockfile-${name}-benchmark`,
    private: true,
    intent: { skills: packageNames },
  })

  for (const packageName of packageNames) {
    const skills = Array.from(
      { length: options.skillCount },
      (_, index) => `skill-${index}`,
    )
    writePackage(join(root, 'node_modules'), packageName, '1.0.0', { skills })
    const packageRoot = join(root, 'node_modules', ...packageName.split('/'))
    for (const skillName of skills) {
      const skillDir = join(packageRoot, 'skills', skillName)
      for (let index = 0; index < options.supportFileCount; index++) {
        const directory = ['references', 'assets', 'scripts'][index % 3]!
        const extension = directory === 'scripts' ? 'mjs' : 'dat'
        const content =
          directory === 'assets'
            ? Buffer.alloc(options.supportFileSize, index)
            : 'x'.repeat(options.supportFileSize)
        writeFile(
          join(skillDir, directory, `support-${index}.${extension}`),
          content,
        )
      }
    }
  }

  return { root, runner: createCliRunner({ cwd: root }) }
}

function defineScenario(name: string, options: FixtureOptions): void {
  const consoleSilencer = createConsoleSilencer()
  let fixture: LockfileFixture | null = null

  async function setup(): Promise<void> {
    if (fixture) return

    consoleSilencer.silence()
    fixture = createFixture(name, options)
    await fixture.runner.setup()
    await fixture.runner.run(['skills', 'approve', '--all', '--yes'])
    if (options.changedSkill) {
      writeFile(
        join(
          fixture.root,
          'node_modules',
          '@bench',
          'lock-0',
          'skills',
          'skill-0',
          'SKILL.md',
        ),
        '---\nname: skill-0\ndescription: changed benchmark skill\n---\n\nChanged.\n',
      )
    }
  }

  function teardown(): void {
    if (fixture) {
      fixture.runner.teardown()
      rmSync(fixture.root, { recursive: true, force: true })
      fixture = null
    }
    consoleSilencer.restore()
  }

  describe(`intent skills scan --json (${name})`, () => {
    beforeAll(setup)
    afterAll(teardown)

    bench(
      'scans lockfile state',
      async () => {
        if (!fixture) throw new Error('Lockfile fixture was not initialized')
        await fixture.runner.run(['skills', 'scan', '--json'])
      },
      createBenchOptions(setup, teardown),
    )
  })
}

defineScenario('clean-eight-packages', {
  packageCount: 8,
  skillCount: 3,
  supportFileCount: 3,
  supportFileSize: 1024,
})

defineScenario('changed-skill', {
  changedSkill: true,
  packageCount: 8,
  skillCount: 3,
  supportFileCount: 3,
  supportFileSize: 1024,
})

defineScenario('large-support-set', {
  packageCount: 24,
  skillCount: 4,
  supportFileCount: 6,
  supportFileSize: 8 * 1024,
})
