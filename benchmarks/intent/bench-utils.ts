import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from '../../packages/intent/src/cli.js'

type SkillOptions = {
  description: string
  bodyLines?: number
  type?: 'core' | 'framework'
  requires?: Array<string>
  libraryVersion?: string
  sources?: Array<string>
}

type PackageOptions = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  skills?: Array<string>
  requires?: Array<string>
  useDerivedIntent?: boolean
  brokenIntent?: boolean
}

type Fixtures = {
  listRoot: string
  listGlobalNodeModules: string
  staleRoot: string
  validateRoot: string
}

type ConsoleSnapshot = {
  error: typeof console.error
  info: typeof console.info
  log: typeof console.log
  warn: typeof console.warn
}

export type BenchmarkSuite = {
  setup: () => void
  teardown: () => void
  runListLoop: () => Promise<void>
  runStaleLoop: () => Promise<void>
  runValidateLoop: () => Promise<void>
}

const noop = () => {}

export function createBenchmarkSuite(): BenchmarkSuite {
  let consoleSnapshot: ConsoleSnapshot | null = null
  let fixtures: Fixtures | null = null

  function silenceConsole() {
    if (consoleSnapshot) return

    consoleSnapshot = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    }

    console.log = noop as typeof console.log
    console.info = noop as typeof console.info
    console.warn = noop as typeof console.warn
    console.error = noop as typeof console.error
  }

  function restoreConsole() {
    if (!consoleSnapshot) return
    console.log = consoleSnapshot.log
    console.info = consoleSnapshot.info
    console.warn = consoleSnapshot.warn
    console.error = consoleSnapshot.error
    consoleSnapshot = null
  }

  function getFixtures() {
    if (fixtures) return fixtures

    silenceConsole()
    fixtures = {
      ...createListFixture(),
      validateRoot: createValidateFixture(),
      staleRoot: createStaleFixture(),
    }

    return fixtures
  }

  return {
    setup() {
      getFixtures()
    },
    teardown() {
      if (fixtures) {
        rmSync(fixtures.listRoot, { recursive: true, force: true })
        rmSync(fixtures.listGlobalNodeModules, { recursive: true, force: true })
        rmSync(fixtures.validateRoot, { recursive: true, force: true })
        rmSync(fixtures.staleRoot, { recursive: true, force: true })
        fixtures = null
      }

      restoreConsole()
    },
    async runListLoop() {
      const state = getFixtures()

      for (let index = 0; index < 3; index++) {
        await runCli(
          ['list', '--json'],
          state.listRoot,
          state.listGlobalNodeModules,
        )
      }
    },
    async runValidateLoop() {
      const state = getFixtures()

      for (let index = 0; index < 3; index++) {
        await runCli(['validate'], state.validateRoot)
      }
    },
    async runStaleLoop() {
      const state = getFixtures()

      for (let index = 0; index < 3; index++) {
        await runCli(['stale', '--json'], state.staleRoot)
      }
    },
  }
}

async function runCli(
  argv: Array<string>,
  cwd: string,
  globalNodeModules?: string,
): Promise<void> {
  const previousCwd = process.cwd()
  const previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES

  try {
    process.chdir(cwd)

    if (globalNodeModules) {
      process.env.INTENT_GLOBAL_NODE_MODULES = globalNodeModules
    } else {
      delete process.env.INTENT_GLOBAL_NODE_MODULES
    }

    const exitCode = await main(argv)
    if (exitCode !== 0) {
      throw new Error(
        `intent ${argv.join(' ')} failed with exit code ${exitCode}`,
      )
    }
  } finally {
    process.chdir(previousCwd)

    if (previousGlobalNodeModules === undefined) {
      delete process.env.INTENT_GLOBAL_NODE_MODULES
    } else {
      process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
    }
  }
}

function createListFixture(): Pick<
  Fixtures,
  'listGlobalNodeModules' | 'listRoot'
> {
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
    listRoot: root,
    listGlobalNodeModules: globalNodeModules,
  }
}

function createValidateFixture(): string {
  const root = createTempDir('validate')

  writeJson(join(root, 'package.json'), {
    name: '@bench/validate-package',
    version: '1.0.0',
    keywords: ['tanstack-intent'],
    files: ['dist', 'skills', '!skills/_artifacts'],
    devDependencies: {
      '@tanstack/intent': 'workspace:*',
    },
  })

  const domains = [
    'foundations',
    'routing',
    'data',
    'testing',
    'tooling',
    'releases',
  ]

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

  return root
}

function createStaleFixture(): string {
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

  return root
}

function writeStalePackage(
  root: string,
  opts: {
    name: string
    packageDir: string
    packageVersion: string
    skillVersion: string
    skills: Array<string>
  },
) {
  const packageRoot = join(root, 'packages', opts.packageDir)

  writeJson(join(packageRoot, 'package.json'), {
    name: opts.name,
    version: opts.packageVersion,
  })

  const syncState: {
    library_version: string
    skills: Record<string, { sources_sha: Record<string, string> }>
  } = {
    library_version: opts.skillVersion,
    skills: {},
  }

  for (const skill of opts.skills) {
    const sources = [
      `docs/${skill.replace(/\//g, '-')}.md`,
      'docs/shared-guide.md',
    ]

    writeSkill(packageRoot, skill, {
      description: `${skill} maintenance guide`,
      bodyLines: 16,
      libraryVersion: opts.skillVersion,
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

function writePackage(
  nodeModulesDir: string,
  name: string,
  version: string,
  opts: PackageOptions,
) {
  const packageRoot = join(nodeModulesDir, ...name.split('/'))
  const packageJson: Record<string, unknown> = {
    name,
    version,
    dependencies: opts.dependencies,
    peerDependencies: opts.peerDependencies,
  }

  if (opts.skills?.length) {
    if (opts.brokenIntent) {
      packageJson.description = `Broken skill fixture for ${name}`
    } else if (opts.useDerivedIntent) {
      packageJson.repository = `https://github.com/example/${name.replace('@', '').replace('/', '-')}`
      packageJson.homepage = `https://example.com/${name.replace('@', '').replace('/', '-')}`
    } else {
      packageJson.intent = {
        version: 1,
        repo: `example/${name.replace('@', '').replace('/', '-')}`,
        docs: 'docs/',
        requires: opts.requires,
      }
    }
  }

  writeJson(join(packageRoot, 'package.json'), packageJson)

  for (const skill of opts.skills ?? []) {
    writeSkill(packageRoot, skill, {
      description: `${skill} benchmark guidance`,
      bodyLines: 14,
      type: skill.includes('/') ? 'framework' : 'core',
      requires: skill.includes('/') ? [skill.split('/')[0]!] : undefined,
    })
  }
}

function writeSkill(root: string, skillName: string, opts: SkillOptions) {
  const frontmatter = [
    `name: ${JSON.stringify(skillName)}`,
    `description: ${JSON.stringify(opts.description)}`,
  ]

  if (opts.type) {
    frontmatter.push(`type: ${JSON.stringify(opts.type)}`)
  }

  if (opts.requires) {
    frontmatter.push('requires:')
    for (const requirement of opts.requires) {
      frontmatter.push(`  - ${JSON.stringify(requirement)}`)
    }
  }

  if (opts.libraryVersion) {
    frontmatter.push(`library_version: ${JSON.stringify(opts.libraryVersion)}`)
  }

  if (opts.sources) {
    frontmatter.push('sources:')
    for (const source of opts.sources) {
      frontmatter.push(`  - ${JSON.stringify(source)}`)
    }
  }

  const bodyLines = Array.from({ length: opts.bodyLines ?? 12 }, (_, index) => {
    return `${index + 1}. Keep ${skillName} aligned with the documented workflow.`
  })

  writeFile(
    join(root, 'skills', ...skillName.split('/'), 'SKILL.md'),
    `---\n${frontmatter.join('\n')}\n---\n\n${bodyLines.join('\n')}\n`,
  )
}

function createTempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `intent-bench-${name}-`))
}

function writeFile(filePath: string, content: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function writeJson(filePath: string, value: unknown) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
