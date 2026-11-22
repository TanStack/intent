import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, bench, describe } from 'vitest'
import {
  createBenchOptions,
  createCliFixture,
  createCliRunner,
  createConsoleSilencer,
  createSlowBenchOptions,
  createTempDir,
  writeExampleLibrary,
  writeExampleSkill,
  writeFile,
  writeJson,
  writeSkill,
} from './helpers.ts'

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

async function expectFailure(
  command: Promise<unknown>,
  message: string,
): Promise<void> {
  if (
    await command.then(
      () => true,
      () => false,
    )
  ) {
    throw new Error(message)
  }
}

const untypedExample = 'Expected validate to typecheck the skill code blocks'

const typedExamples = createCliFixture(
  'validate-typed-examples',
  async (root, capture) => {
    writeExampleLibrary(root, '@bench/client')
    for (let index = 1; index < 20; index++) {
      writeExampleSkill(root, `resource-${index}`, '@bench/client', index)
    }

    writeExampleSkill(root, 'resource-0', '@bench/client', "'many'")
    await expectFailure(capture(['validate']), untypedExample)
    writeExampleSkill(root, 'resource-0', '@bench/client', 20)
  },
)

describe('intent validate with typed examples', () => {
  beforeAll(typedExamples.setup)
  afterAll(typedExamples.teardown)

  bench(
    'typechecks code blocks that import the package',
    async () => {
      await typedExamples.run(['validate'])
    },
    createSlowBenchOptions(typedExamples.setup, typedExamples.teardown),
  )
})

const typedMonorepo = createCliFixture(
  'validate-typed-monorepo',
  async (root, capture) => {
    writeJson(join(root, 'package.json'), {
      name: 'intent-validate-typed-monorepo-benchmark',
      private: true,
      workspaces: ['packages/*'],
      devDependencies: {
        '@tanstack/intent': 'workspace:*',
      },
    })
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    )

    for (const name of ['core', 'angular', 'react', 'solid', 'svelte', 'vue']) {
      const packageRoot = join(root, 'packages', name)
      writeExampleLibrary(
        packageRoot,
        `@bench/${name}`,
        name === 'core' ? undefined : '@bench/core',
      )
      for (let index = 1; index <= 4; index++) {
        writeExampleSkill(
          packageRoot,
          `${name}-resource-${index}`,
          `@bench/${name}`,
          index,
        )
      }
    }

    const packageRoot = join(root, 'packages', 'vue')
    writeExampleSkill(packageRoot, 'vue-resource-1', '@bench/vue', "'many'")
    await expectFailure(capture(['validate']), untypedExample)
    writeExampleSkill(packageRoot, 'vue-resource-1', '@bench/vue', 1)
  },
)

describe('intent validate in a monorepo with typed examples', () => {
  beforeAll(typedMonorepo.setup)
  afterAll(typedMonorepo.teardown)

  bench(
    'typechecks code blocks for every workspace package',
    async () => {
      await typedMonorepo.run(['validate'])
    },
    createSlowBenchOptions(typedMonorepo.setup, typedMonorepo.teardown),
  )
})

let fixed = false

function writeLegacySkills(root: string): void {
  for (let index = 0; index < 30; index++) {
    const name = `task-${index}`
    writeFile(
      join(root, 'skills', name, 'SKILL.md'),
      [
        '---',
        `name: ${name}`,
        `description: Use for ${name}.`,
        'type: core',
        'library_version: "1.0.0"',
        '---',
        '',
        `Keep ${name} aligned with the documented workflow.`,
        '',
      ].join('\n'),
    )
  }
  fixed = false
}

const pendingFix = createCliFixture('validate-fix', async (root, capture) => {
  writeJson(join(root, 'package.json'), {
    name: '@bench/validate-fix',
    version: '1.0.0',
    keywords: ['tanstack-intent'],
    files: ['dist', 'skills'],
    devDependencies: {
      '@tanstack/intent': 'workspace:*',
    },
  })
  writeLegacySkills(root)
  await expectFailure(
    capture(['validate', '--check']),
    'Expected a pending frontmatter migration',
  )
})

describe('intent validate --fix', () => {
  beforeAll(pendingFix.setup)
  afterAll(pendingFix.teardown)
  // CodSpeed runs this hook outside its measurement; Vitest's tinybench runner never calls it.
  beforeEach(() => writeLegacySkills(pendingFix.root))

  bench(
    'migrates pending frontmatter in every skill',
    async () => {
      if (fixed) writeLegacySkills(pendingFix.root)
      await pendingFix.run(['validate', '--fix'])
      fixed = true
    },
    createBenchOptions(pendingFix.setup, pendingFix.teardown),
  )
})
