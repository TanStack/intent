import { readFileSync, rmSync } from 'node:fs'
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
  writeSkill,
} from './helpers.ts'

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

async function setupWithArtifacts(): Promise<void> {
  await setup()
  const { root } = getFixture()
  const skills = ['alpha', 'beta', 'gamma', 'delta'].flatMap((name) => {
    const state = JSON.parse(
      readFileSync(
        join(root, 'packages', name, 'skills', 'sync-state.json'),
        'utf8',
      ),
    ) as { skills: Record<string, unknown> }
    return Object.keys(state.skills).map((skill) => ({
      package: `packages/${name}`,
      slug: skill,
      path: `packages/${name}/skills/${skill}/SKILL.md`,
    }))
  })
  writeJson(join(root, '_artifacts', 'skill_tree.yaml'), { skills })
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

  bench(
    'reports workspace drift with shared artifacts',
    async () => {
      const state = getFixture()
      for (let index = 0; index < 3; index++) {
        await state.runner.run(['stale', '--json'])
      }
    },
    createBenchOptions(setupWithArtifacts, teardown),
  )
})

type StaleReport = {
  skills: Array<unknown>
  signals: Array<unknown>
}

async function expectReports(
  output: Promise<string>,
  count: number,
): Promise<Array<StaleReport>> {
  const reports = JSON.parse(await output) as Array<StaleReport>
  if (
    reports.length !== count ||
    reports.some((report) => report.signals.length > 0)
  ) {
    throw new Error(`Unexpected stale reports: ${JSON.stringify(reports)}`)
  }

  return reports
}

const workspacePackages = 40

const largeWorkspace = createCliFixture(
  'stale-large-workspace',
  async (root, capture) => {
    writeJson(join(root, 'package.json'), {
      name: 'intent-stale-large-workspace-benchmark',
      private: true,
      workspaces: ['packages/*'],
    })
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    )

    const artifactSkills: Array<{
      package: string
      slug: string
      path: string
    }> = []
    for (let index = 0; index < workspacePackages; index++) {
      const packageDir = `pkg-${index}`
      const skills = ['core', 'cache', 'streaming', 'runtime'].map(
        (skill) => `${packageDir}/${skill}`,
      )
      writeStalePackage(root, {
        name: `@bench/${packageDir}`,
        packageDir,
        packageVersion: '2.1.0',
        skillVersion: '2.0.0',
        skills,
      })
      for (const slug of skills) {
        artifactSkills.push({
          package: `packages/${packageDir}`,
          slug,
          path: `packages/${packageDir}/skills/${slug}/SKILL.md`,
        })
      }
    }
    writeJson(join(root, '_artifacts', 'skill_tree.yaml'), {
      skills: artifactSkills,
    })

    await expectReports(capture(['stale', '--json']), workspacePackages)
    await expectReports(capture(['stale', 'packages/pkg-20', '--json']), 1)
  },
)

describe('intent stale in a large workspace', () => {
  beforeAll(largeWorkspace.setup)
  afterAll(largeWorkspace.teardown)

  bench(
    'reports drift for every package with shared artifacts',
    async () => {
      await largeWorkspace.run(['stale', '--json'])
    },
    createBenchOptions(largeWorkspace.setup, largeWorkspace.teardown),
  )

  bench(
    'checks only the targeted package',
    async () => {
      for (let index = 0; index < 10; index++) {
        await largeWorkspace.run(['stale', 'packages/pkg-20', '--json'])
      }
    },
    createBenchOptions(largeWorkspace.setup, largeWorkspace.teardown),
  )
})

const namedSkills = 200

const artifactNames = createCliFixture(
  'stale-artifact-names',
  async (root, capture) => {
    writeJson(join(root, 'package.json'), {
      name: '@bench/artifact-names',
      version: '1.0.0',
    })

    const slugs = Array.from(
      { length: namedSkills },
      (_, index) => `skill-${index}`,
    )
    for (const slug of slugs) {
      writeSkill(root, slug, {
        description: `${slug} maintenance guide`,
        libraryVersion: '1.0.0',
      })
    }
    writeJson(join(root, '_artifacts', 'skill_tree.yaml'), {
      skills: slugs.map((slug) => ({ slug })),
    })

    const [report] = await expectReports(capture(['stale', '--json']), 1)
    if (report!.skills.length !== namedSkills) {
      throw new Error(`Expected ${namedSkills} skills in the stale report`)
    }
  },
)

describe('intent stale with many artifact entries', () => {
  beforeAll(artifactNames.setup)
  afterAll(artifactNames.teardown)

  bench(
    'matches artifact entries to skills by name',
    async () => {
      await artifactNames.run(['stale', '--json'])
    },
    createBenchOptions(artifactNames.setup, artifactNames.teardown),
  )
})

const installedPackages = 20

const installedDependencies = createCliFixture(
  'stale-installed-dependencies',
  async (root, capture) => {
    const dependencies: Record<string, string> = {}
    for (let index = 0; index < installedPackages; index++) {
      const name = `@bench/installed-${index}`
      dependencies[name] = '1.0.0'
      writePackage(join(root, 'node_modules'), name, '1.0.0', {
        skills: ['core', 'core/cache', 'core/streaming', 'core/runtime'],
      })
    }
    writeJson(join(root, 'package.json'), {
      name: 'intent-stale-installed-dependencies-benchmark',
      private: true,
      dependencies,
    })
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
    )
    writeJson(join(root, 'packages', 'app', 'package.json'), {
      name: '@consumer/app',
      version: '1.0.0',
    })

    await expectReports(capture(['stale', '--json']), installedPackages)
  },
)

describe('intent stale for installed dependencies', () => {
  beforeAll(installedDependencies.setup)
  afterAll(installedDependencies.teardown)

  bench(
    'reports installed packages through the fallback scan',
    async () => {
      await installedDependencies.run(['stale', '--json'])
    },
    createBenchOptions(
      installedDependencies.setup,
      installedDependencies.teardown,
    ),
  )
})
