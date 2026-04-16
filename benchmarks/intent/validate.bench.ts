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

type ValidateFixture = {
  root: string
  runner: ReturnType<typeof createCliRunner>
}

const consoleSilencer = createConsoleSilencer()
let fixture: ValidateFixture | null = null

function createFixture(): ValidateFixture {
  const root = createTempDir('validate')
  const domains = [
    'foundations',
    'routing',
    'data',
    'testing',
    'tooling',
    'releases',
  ]

  writeJson(join(root, 'package.json'), {
    name: '@bench/validate-package',
    version: '1.0.0',
    keywords: ['tanstack-intent'],
    files: ['dist', 'skills', '!skills/_artifacts'],
    devDependencies: {
      '@tanstack/intent': 'workspace:*',
    },
  })

  for (const domain of domains) {
    writeSkill(root, domain, {
      description: `${domain} overview and guardrails`,
      bodyLines: 20,
      type: 'core',
    })

    for (let index = 1; index <= 4; index++) {
      const skillName = `${domain}/workflow-${index}`
      const isFrameworkSkill = index % 2 === 0

      writeSkill(root, skillName, {
        description: `${domain} workflow ${index}`,
        bodyLines: 18,
        type: isFrameworkSkill ? 'framework' : 'core',
        requires: isFrameworkSkill ? [domain] : undefined,
      })
    }
  }

  writeFile(
    join(root, 'skills', '_artifacts', 'domain_map.yaml'),
    [
      'domains:',
      ...domains.map((domain) => `  - ${JSON.stringify(domain)}`),
      '',
    ].join('\n'),
  )
  writeFile(
    join(root, 'skills', '_artifacts', 'skill_spec.md'),
    '# Skill specification\n\nGenerated for the benchmark fixture.\n',
  )
  writeFile(
    join(root, 'skills', '_artifacts', 'skill_tree.yaml'),
    [
      'skills:',
      ...domains.flatMap((domain) => [
        `  - ${JSON.stringify(domain)}`,
        `  - ${JSON.stringify(`${domain}/workflow-1`)}`,
        `  - ${JSON.stringify(`${domain}/workflow-2`)}`,
        `  - ${JSON.stringify(`${domain}/workflow-3`)}`,
        `  - ${JSON.stringify(`${domain}/workflow-4`)}`,
      ]),
      '',
    ].join('\n'),
  )

  return {
    root,
    runner: createCliRunner({ cwd: root }),
  }
}

function getFixture(): ValidateFixture {
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

describe('intent validate', () => {
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'checks a shipped skills tree',
    async () => {
      const state = getFixture()
      for (let index = 0; index < 3; index++) {
        await state.runner.run(['validate'])
      }
    },
    createBenchOptions(setup, teardown),
  )
})
