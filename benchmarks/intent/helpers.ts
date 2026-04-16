import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let builtCliMainPromise: Promise<
  (argv?: Array<string>) => Promise<number>
> | null = null

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
  let main: ((argv?: Array<string>) => Promise<number>) | null = null
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
    async run(argv: Array<string>) {
      if (!main) {
        throw new Error('CLI runner must be set up before running benchmarks')
      }

      const exitCode = await main(argv)
      if (exitCode !== 0) {
        throw new Error(
          `intent ${argv.join(' ')} failed with exit code ${exitCode}`,
        )
      }
    },
  }
}

async function loadBuiltCliMain(): Promise<
  (argv?: Array<string>) => Promise<number>
> {
  builtCliMainPromise ??= import('../../packages/intent/dist/cli.mjs').then(
    (module) => {
      if (typeof module.main !== 'function') {
        throw new TypeError(
          'Expected packages/intent/dist/cli.mjs to export main()',
        )
      }

      return module.main as (argv?: Array<string>) => Promise<number>
    },
  )

  return builtCliMainPromise
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
    `name: ${JSON.stringify(skillName)}`,
    `description: ${JSON.stringify(options.description)}`,
  ]

  if (options.type) {
    frontmatter.push(`type: ${JSON.stringify(options.type)}`)
  }

  if (options.requires) {
    frontmatter.push('requires:')
    for (const requirement of options.requires) {
      frontmatter.push(`  - ${JSON.stringify(requirement)}`)
    }
  }

  if (options.libraryVersion) {
    frontmatter.push(
      `library_version: ${JSON.stringify(options.libraryVersion)}`,
    )
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
