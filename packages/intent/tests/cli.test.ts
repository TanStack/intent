import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_PROMPT } from '../src/install-prompt.js'
import { main, USAGE } from '../src/cli.js'

const thisDir = dirname(fileURLToPath(import.meta.url))
const metaDir = join(thisDir, '..', 'meta')
const packageJsonPath = join(thisDir, '..', 'package.json')

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeSkillMd(dir: string, frontmatter: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  const yamlLines = Object.entries(frontmatter)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? `"${value}"` : value}`,
    )
    .join('\n')

  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\n${yamlLines}\n---\n\nSkill content here.\n`,
  )
}

let originalCwd: string
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let tempDirs: Array<string>

beforeEach(() => {
  originalCwd = process.cwd()
  tempDirs = []
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(originalCwd)
  logSpy.mockRestore()
  errorSpy.mockRestore()
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('intent meta', () => {
  it('lists the shipped public meta-skills', async () => {
    const exitCode = await main(['meta'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Meta-skills')
    expect(output).toContain('domain-discovery')
    expect(output).toContain('tree-generator')
    expect(output).toContain('generate-skill')
    expect(output).toContain('skill-staleness-check')
  })

  it('prints the requested meta-skill content', async () => {
    const expected = readFileSync(
      join(metaDir, 'domain-discovery', 'SKILL.md'),
      'utf8',
    )

    const exitCode = await main(['meta', 'domain-discovery'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expected)
  })

  it('fails cleanly for invalid meta-skill names', async () => {
    const exitCode = await main(['meta', '../bad'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Invalid meta-skill name: "../bad"')
  })

  it('fails cleanly when a meta-skill does not exist', async () => {
    const exitCode = await main(['meta', 'missing-skill'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Meta-skill "missing-skill" not found. Run `intent meta` to list available meta-skills.',
    )
  })
})

describe('cli commands', () => {
  it('prints top-level help when no command is provided', async () => {
    const exitCode = await main([])

    expect(exitCode).toBe(0)
    expect(logSpy.mock.calls[0]?.[0]).toContain(USAGE)
    expect(logSpy.mock.calls[0]?.[0]).toContain('Run `intent help <command>`')
  })

  it('prints top-level help for --help', async () => {
    const exitCode = await main(['--help'])

    expect(exitCode).toBe(0)
    expect(logSpy.mock.calls[0]?.[0]).toContain('Run `intent help <command>`')
  })

  it('prints command help for help subcommands', async () => {
    const exitCode = await main(['help', 'validate'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('intent validate [dir]'),
    )
  })

  it('prints command help when --help is passed after a subcommand', async () => {
    const exitCode = await main(['list', '--help'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('intent list --json'),
    )
  })

  it('prints the install prompt', async () => {
    const exitCode = await main(['install'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(INSTALL_PROMPT)
  })

  it('lists installed intent packages as json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-list-'))
    tempDirs.push(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'db')

    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{ name: string; version: string; packageRoot: string }>
      conflicts: Array<{ packageName: string }>
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/db',
      version: '0.5.2',
      packageRoot: pkgDir,
    })
    expect(parsed.conflicts).toEqual([])
    expect(parsed.warnings).toEqual([])
  })

  it('explains which package version was chosen when conflicts exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-conflicts-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: {
        'consumer-a': '1.0.0',
        'consumer-b': '1.0.0',
      },
    })

    const consumerADir = join(root, 'node_modules', 'consumer-a')
    const consumerBDir = join(root, 'node_modules', 'consumer-b')
    const queryV4Dir = join(consumerADir, 'node_modules', '@tanstack', 'query')
    const queryV5Dir = join(consumerBDir, 'node_modules', '@tanstack', 'query')

    writeJson(join(consumerADir, 'package.json'), {
      name: 'consumer-a',
      version: '1.0.0',
      dependencies: { '@tanstack/query': '4.0.0' },
    })
    writeJson(join(consumerBDir, 'package.json'), {
      name: 'consumer-b',
      version: '1.0.0',
      dependencies: { '@tanstack/query': '5.0.0' },
    })
    writeJson(join(queryV4Dir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeJson(join(queryV5Dir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(queryV4Dir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query v4 skill',
    })
    writeSkillMd(join(queryV5Dir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query v5 skill',
    })

    process.chdir(root)

    const exitCode = await main(['list'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Version conflicts:')
    expect(output).toContain('@tanstack/query -> using 5.0.0')
    expect(output).toContain(`chosen: ${queryV5Dir}`)
    expect(output).toContain(`also found: 4.0.0 at ${queryV4Dir}`)
  })

  it('validates a well-formed skills directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-validate-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      '✅ Validated 1 skill files — all passed',
    )
  })

  it('validates package skills from repo root without root packaging warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-validate-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      bin: { intent: './bin/intent.js' },
      files: ['skills', 'bin', '!skills/_artifacts'],
    })
    mkdirSync(join(root, 'packages', 'router', 'bin'), { recursive: true })
    writeFileSync(join(root, 'packages', 'router', 'bin', 'intent.js'), '')
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate', 'packages/router/skills'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
  })

  it('fails cleanly when validate is run without a skills directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-missing-skills-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      `Skills directory not found: ${join(root, 'skills')}`,
    )
  })

  it('fails cleanly for unsupported yarn pnp projects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-pnp-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    writeFileSync(join(root, '.pnp.cjs'), 'module.exports = {}\n')
    process.chdir(root)

    const exitCode = await main(['list'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Yarn PnP is not yet supported. Add `nodeLinker: node-modules` to your .yarnrc.yml to use intent.',
    )
  })

  it('fails cleanly for deno projects without node_modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-deno-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    writeFileSync(join(root, 'deno.json'), '{"nodeModulesDir":"none"}\n')
    process.chdir(root)

    const exitCode = await main(['list'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Deno without node_modules is not yet supported. Add `"nodeModulesDir": "auto"` to your deno.json to use intent.',
    )
  })

  it('checks workspace packages for staleness from the monorepo root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-stale-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')

    fetchSpy.mockRestore()
  })
})

describe('package metadata', () => {
  it('uses a package-manager-neutral prepack script', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.prepack).toBe('npm run build')
  })
})
