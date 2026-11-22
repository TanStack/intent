import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

type CliMain = (argv?: Array<string>, runtime?: object) => Promise<number>

let builtCliMainPromise: Promise<CliMain> | null = null

type CliRunnerOptions = {
  cwd: string
  globalNodeModules?: string
}

type ConsoleSnapshot = {
  error: typeof console.error
  info: typeof console.info
  log: typeof console.log
  warn: typeof console.warn
}

export type SkillOptions = {
  description: string
  bodyLines?: number
  type?: 'core' | 'framework'
  requires?: Array<string>
  libraryVersion?: string
  sources?: Array<string>
}

export type PackageOptions = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  skills?: Array<string>
  requires?: Array<string>
  useDerivedIntent?: boolean
  brokenIntent?: boolean
}

const noop = () => undefined

export function createBenchOptions(
  setup: () => void | Promise<void>,
  teardown: () => void | Promise<void>,
) {
  return {
    warmupIterations: 100,
    time: 10_000,
    setup,
    teardown,
  }
}

export function createSlowBenchOptions(
  setup: () => void | Promise<void>,
  teardown: () => void | Promise<void>,
) {
  return {
    warmupIterations: 3,
    time: 3_000,
    setup,
    teardown,
  }
}

export function createConsoleSilencer() {
  let snapshot: ConsoleSnapshot | null = null

  return {
    silence() {
      if (snapshot) return

      snapshot = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
      }

      console.log = noop as typeof console.log
      console.info = noop as typeof console.info
      console.warn = noop as typeof console.warn
      console.error = noop as typeof console.error
    },
    restore() {
      if (!snapshot) return

      console.log = snapshot.log
      console.info = snapshot.info
      console.warn = snapshot.warn
      console.error = snapshot.error
      snapshot = null
    },
  }
}

export function createCliRunner(options: CliRunnerOptions) {
  let main: CliMain | null = null
  let previousCwd = ''
  let previousGlobalNodeModules: string | undefined

  return {
    async setup() {
      if (main) return

      previousCwd = process.cwd()
      previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES

      process.chdir(options.cwd)
      if (options.globalNodeModules) {
        process.env.INTENT_GLOBAL_NODE_MODULES = options.globalNodeModules
      } else {
        delete process.env.INTENT_GLOBAL_NODE_MODULES
      }

      main = await loadBuiltCliMain()
    },
    teardown() {
      if (!main) return

      process.chdir(previousCwd)
      if (previousGlobalNodeModules === undefined) {
        delete process.env.INTENT_GLOBAL_NODE_MODULES
      } else {
        process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
      }

      previousCwd = ''
      previousGlobalNodeModules = undefined
      main = null
    },
    async run(argv: Array<string>, runtime?: object) {
      if (!main) {
        throw new Error('CLI runner must be set up before running benchmarks')
      }

      const exitCode = await main(argv, runtime)
      if (exitCode !== 0) {
        throw new Error(
          `intent ${argv.join(' ')} failed with exit code ${exitCode}`,
        )
      }
    },
  }
}

async function loadBuiltCliMain(): Promise<CliMain> {
  builtCliMainPromise ??= import('../../packages/intent/dist/cli.mjs').then(
    (module) => {
      if (typeof module.main !== 'function') {
        throw new TypeError(
          'Expected packages/intent/dist/cli.mjs to export main()',
        )
      }

      return module.main as CliMain
    },
  )

  return builtCliMainPromise
}

export function createCliFixture(
  name: string,
  write: (
    root: string,
    capture: (argv: Array<string>, runtime?: object) => Promise<string>,
  ) => void | Promise<void>,
) {
  const consoleSilencer = createConsoleSilencer()
  let fixture: {
    root: string
    runner: ReturnType<typeof createCliRunner>
  } | null = null

  function current() {
    if (!fixture) {
      throw new Error(`Fixture ${name} must be set up before use`)
    }

    return fixture
  }

  async function capture(
    argv: Array<string>,
    runtime?: object,
  ): Promise<string> {
    const silenced = console.log
    const lines: Array<string> = []
    console.log = (...values: Array<unknown>) => {
      lines.push(values.join(' '))
    }
    try {
      await current().runner.run(argv, runtime)
    } finally {
      console.log = silenced
    }
    return lines.join('\n')
  }

  function teardown(): void {
    if (fixture) {
      fixture.runner.teardown()
      rmSync(fixture.root, { recursive: true, force: true })
      fixture = null
    }

    consoleSilencer.restore()
  }

  return {
    get root(): string {
      return current().root
    },
    async setup(): Promise<void> {
      if (fixture) return

      consoleSilencer.silence()
      const root = createTempDir(name)
      fixture = { root, runner: createCliRunner({ cwd: root }) }
      try {
        await fixture.runner.setup()
        await write(root, capture)
      } catch (err) {
        teardown()
        throw err
      }
    },
    teardown,
    run(argv: Array<string>, runtime?: object): Promise<void> {
      return current().runner.run(argv, runtime)
    },
  }
}

export function git(root: string, ...args: Array<string>): void {
  execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'user.name=Benchmark',
      '-c',
      'user.email=benchmark@example.invalid',
      ...args,
    ],
    { cwd: root, stdio: 'ignore' },
  )
}

export function createTempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `intent-bench-${name}-`))
}

export function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

export function writeJson(filePath: string, value: unknown): void {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function writeSkill(
  root: string,
  skillName: string,
  options: SkillOptions,
): void {
  const frontmatter = [
    `name: ${JSON.stringify(basename(skillName))}`,
    `description: ${JSON.stringify(options.description)}`,
  ]

  if (options.type || options.libraryVersion) {
    frontmatter.push('metadata:')
    if (options.type) {
      frontmatter.push(`  type: ${JSON.stringify(options.type)}`)
    }
    if (options.libraryVersion) {
      frontmatter.push(
        `  library_version: ${JSON.stringify(options.libraryVersion)}`,
      )
    }
  }

  if (options.requires) {
    frontmatter.push('requires:')
    for (const requirement of options.requires) {
      frontmatter.push(`  - ${JSON.stringify(requirement)}`)
    }
  }

  if (options.sources) {
    frontmatter.push('sources:')
    for (const source of options.sources) {
      frontmatter.push(`  - ${JSON.stringify(source)}`)
    }
  }

  const bodyLines = Array.from(
    { length: options.bodyLines ?? 12 },
    (_, index) =>
      `${index + 1}. Keep ${skillName} aligned with the documented workflow.`,
  )

  writeFile(
    join(root, 'skills', ...skillName.split('/'), 'SKILL.md'),
    `---\n${frontmatter.join('\n')}\n---\n\n${bodyLines.join('\n')}\n`,
  )
}

export function writePackage(
  nodeModulesDir: string,
  name: string,
  version: string,
  options: PackageOptions,
): void {
  const packageRoot = join(nodeModulesDir, ...name.split('/'))
  const packageJson: Record<string, unknown> = {
    name,
    version,
    dependencies: options.dependencies,
    peerDependencies: options.peerDependencies,
  }

  if (options.skills?.length) {
    if (options.brokenIntent) {
      packageJson.description = `Broken skill fixture for ${name}`
    } else if (options.useDerivedIntent) {
      const packageSlug = name.replace('@', '').replace('/', '-')
      packageJson.repository = `https://github.com/example/${packageSlug}`
      packageJson.homepage = `https://example.com/${packageSlug}`
    } else {
      packageJson.intent = {
        version: 1,
        repo: `example/${name.replace('@', '').replace('/', '-')}`,
        docs: 'docs/',
        requires: options.requires,
      }
    }
  }

  writeJson(join(packageRoot, 'package.json'), packageJson)

  for (const skill of options.skills ?? []) {
    writeSkill(packageRoot, skill, {
      description: `${skill} benchmark guidance`,
      bodyLines: 14,
      type: skill.includes('/') ? 'framework' : 'core',
      requires: skill.includes('/') ? [skill.split('/')[0]!] : undefined,
    })
  }
}

export function writeExampleLibrary(
  packageRoot: string,
  name: string,
  dependency?: string,
): void {
  writeJson(join(packageRoot, 'package.json'), {
    name,
    version: '1.0.0',
    repository: `https://github.com/example/${basename(name)}`,
    keywords: ['tanstack-intent'],
    files: ['dist', 'skills'],
    devDependencies: {
      '@tanstack/intent': 'workspace:*',
    },
  })
  writeFile(
    join(packageRoot, 'src', 'index.ts'),
    [
      ...(dependency
        ? [
            `import type { RetryOptions } from '${dependency}'`,
            `export type { RetryOptions } from '${dependency}'`,
          ]
        : [
            'export interface RetryOptions {',
            '  attempts: number',
            '  delay?: number',
            '}',
          ]),
      'export interface ClientOptions {',
      '  baseUrl: string',
      '  retry?: RetryOptions',
      '}',
      'export interface ClientResponse<TData> {',
      '  status: number',
      '  data: TData',
      '}',
      'export interface Client {',
      '  request: <TData>(path: string) => Promise<ClientResponse<TData>>',
      '}',
      'export declare function createClient(options: ClientOptions): Client',
      '',
    ].join('\n'),
  )
}

export function writeExampleSkill(
  packageRoot: string,
  skillName: string,
  library: string,
  attempts: number | string,
): void {
  writeFile(
    join(packageRoot, 'skills', skillName, 'SKILL.md'),
    [
      '---',
      `name: ${JSON.stringify(skillName)}`,
      `description: ${JSON.stringify(`Use when requesting ${skillName}.`)}`,
      'sources:',
      '  - "src/index.ts"',
      '---',
      '',
      `# ${skillName}`,
      '',
      '```ts',
      `import { createClient } from '${library}'`,
      `import type { RetryOptions } from '${library}'`,
      '',
      `const retry: RetryOptions = { attempts: ${attempts}, delay: 250 }`,
      "const client = createClient({ baseUrl: 'https://example.invalid', retry })",
      `const response = await client.request<{ id: number }>('/${skillName}')`,
      'response.data.id',
      '```',
      '',
    ].join('\n'),
  )
}
