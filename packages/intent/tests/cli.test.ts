import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_PROMPT } from '../src/commands/install.js'
import { main } from '../src/cli.js'

const thisDir = dirname(fileURLToPath(import.meta.url))
const metaDir = join(thisDir, '..', 'meta')
const packageJsonPath = join(thisDir, '..', 'package.json')
const realTmpdir = realpathSync(tmpdir())

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

function writeInstalledIntentPackage(
  root: string,
  {
    description,
    name,
    skillName,
    version,
  }: {
    description: string
    name: string
    skillName: string
    version: string
  },
): void {
  const pkgDir = join(root, 'node_modules', ...name.split('/'))
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version,
    intent: { version: 1, repo: 'TanStack/test', docs: 'docs/' },
  })
  writeSkillMd(join(pkgDir, 'skills', skillName), {
    name: skillName,
    description,
  })
}

let originalCwd: string
let logSpy: ReturnType<typeof vi.spyOn>
let infoSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let tempDirs: Array<string>
let previousGlobalNodeModules: string | undefined

function getHelpOutput(): string {
  return [...infoSpy.mock.calls, ...logSpy.mock.calls]
    .map((call) => String(call[0] ?? ''))
    .join('')
}

beforeEach(() => {
  originalCwd = process.cwd()
  tempDirs = []
  previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES
  delete process.env.INTENT_GLOBAL_NODE_MODULES
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(originalCwd)
  if (previousGlobalNodeModules === undefined) {
    delete process.env.INTENT_GLOBAL_NODE_MODULES
  } else {
    process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
  }
  logSpy.mockRestore()
  infoSpy.mockRestore()
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
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('Usage:')
    expect(output).toContain('$ intent <command> [options]')
    expect(output).toContain('Commands:')
  })

  it('prints top-level help for --help', async () => {
    const exitCode = await main(['--help'])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('Usage:')
    expect(output).toContain('$ intent <command> [options]')
  })

  it('prints top-level help for unknown commands', async () => {
    const exitCode = await main(['wat'])
    const output = getHelpOutput()

    expect(exitCode).toBe(1)
    expect(output).toContain('Usage:')
    expect(output).toContain('Commands:')
  })

  it('prints command help for help subcommands', async () => {
    const exitCode = await main(['help', 'validate'])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('$ intent validate [dir]')
  })

  it('fails cleanly for unknown help subcommands', async () => {
    const exitCode = await main(['help', 'wat'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Unknown command: wat')
  })

  it('prints command help when --help is passed after a subcommand', async () => {
    const exitCode = await main(['list', '--help'])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('$ intent list [--json]')
    expect(output).toContain('--json')
  })

  it('prints the install prompt', async () => {
    const exitCode = await main(['install', '--print-prompt'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(INSTALL_PROMPT)
  })

  it('writes install mappings and is idempotent', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install'])
    const agentsPath = join(root, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf8')
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Created AGENTS.md with 1 mapping.')
    expect(content).toContain(
      'task: "Use @tanstack/query fetching: Query data fetching patterns"',
    )
    expect(content).toContain(
      'load: "node_modules/@tanstack/query/skills/fetching/SKILL.md"',
    )
    expect(content).not.toContain(root)

    logSpy.mockClear()

    const secondExitCode = await main(['install'])
    const secondOutput = logSpy.mock.calls.flat().join('\n')

    expect(secondExitCode).toBe(0)
    expect(secondOutput).toContain(
      'No changes to AGENTS.md; 1 mapping already current.',
    )
    expect(readFileSync(agentsPath, 'utf8')).toBe(content)
  })

  it('prints generated install mappings without writing during dry run', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-dry-run-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-dry-run-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/router',
      version: '1.0.0',
      skillName: 'routing',
      description: 'Router patterns',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Generated 1 mapping for AGENTS.md.')
    expect(output).toContain(
      'task: "Use @tanstack/router routing: Router patterns"',
    )
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('does not create an agent config when install has no actionable skills', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-empty-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('No top-level actionable intent skills found.')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('ignores configured global packages during install by default', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-local-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-local-only-global-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('No top-level actionable intent skills found.')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('includes configured global packages during install when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--global', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Generated 1 mapping for AGENTS.md.')
    expect(output).toContain(
      'task: "Use @tanstack/query fetching: Global fetching skill"',
    )
  })

  it('prints the scaffold prompt', async () => {
    const exitCode = await main(['scaffold'])
    const output = String(logSpy.mock.calls[0]?.[0])

    expect(exitCode).toBe(0)
    expect(output).toContain('## Step 1')
    expect(output).toContain('meta/domain-discovery/SKILL.md')
  })

  it('updates package.json for skill publishing', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-edit-package-json-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
    })

    process.chdir(root)

    const exitCode = await main(['edit-package-json'])
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      keywords?: Array<string>
      files?: Array<string>
    }
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(pkg.keywords).toContain('tanstack-intent')
    expect(pkg.files).toContain('skills')
    expect(pkg.files).toContain('!skills/_artifacts')
    expect(output).toContain('Added keywords: "tanstack-intent"')
  })

  it('copies github workflow templates', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-setup-gha-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@scope/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'scope/pkg', docs: 'docs/' },
    })

    process.chdir(root)

    const exitCode = await main(['setup-github-actions'])
    const workflowsDir = join(root, '.github', 'workflows')
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(existsSync(workflowsDir)).toBe(true)
    expect(output).toContain('Copied workflow:')
    expect(output).toContain('Template variables applied:')
  })

  it('copies github workflow templates to the workspace root', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-setup-gha-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      intent: { version: 1, repo: 'TanStack/router', docs: 'docs/' },
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
    })

    process.chdir(join(root, 'packages', 'router'))

    const exitCode = await main(['setup-github-actions'])
    const rootWorkflowsDir = join(root, '.github', 'workflows')
    const packageWorkflowsDir = join(
      root,
      'packages',
      'router',
      '.github',
      'workflows',
    )
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(existsSync(rootWorkflowsDir)).toBe(true)
    expect(existsSync(packageWorkflowsDir)).toBe(false)
    expect(output).toContain('Mode:     monorepo')
  })

  it('lists installed intent packages as json', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
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

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        version: string
        packageRoot: string
        source: 'local' | 'global'
      }>
      conflicts: Array<{ packageName: string }>
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/db',
      version: '0.5.2',
      packageRoot: pkgDir,
      source: 'local',
    })
    expect(parsed.conflicts).toEqual([])
    expect(parsed.warnings).toEqual([])
  })

  it('ignores configured global intent packages in list json output by default', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-local-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-local-only-global-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      nodeModules: { global: { scanned: boolean } }
      packages: Array<{ name: string }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.nodeModules.global.scanned).toBe(false)
    expect(parsed.packages).toEqual([])
  })

  it('includes configured global intent packages in list json output when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        version: string
        packageRoot: string
        source: 'local' | 'global'
        skills: Array<{ path: string }>
      }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/query',
      version: '5.0.0',
      packageRoot: globalPkgDir,
      source: 'global',
    })
    expect(parsed.packages[0]!.skills[0]!.path).toBe(
      join(globalPkgDir, 'skills', 'fetching', 'SKILL.md'),
    )
  })

  it('does not print absolute global skill paths in global list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-global-human-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-global-human-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Global fetching skill')
    expect(output).toContain(
      'Lookup: Runtime lookup only: run `npx @tanstack/intent@latest list --json`, find package "@tanstack/query" skill "fetching", and load its reported path for this session. Do not copy the resolved path into this file.',
    )
    expect(output).not.toContain(globalPkgDir)
  })

  it('prefers local over global in list json output when both exist', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-mixed-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-mixed-global-'),
    )
    tempDirs.push(root, globalRoot)

    const localPkgDir = join(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(localPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.1.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(localPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Local fetching skill',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        version: string
        source: 'local' | 'global'
      }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/query',
      version: '5.1.0',
      source: 'local',
    })
  })

  it('lists global-only packages without local packages when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-global-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-global-only-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.1.0',
      skillName: 'fetching',
      description: 'Local fetching skill',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global-only', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      nodeModules: {
        global: { scanned: boolean }
        local: { scanned: boolean }
      }
      packages: Array<{
        name: string
        source: 'local' | 'global'
        version: string
      }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.nodeModules.local.scanned).toBe(false)
    expect(parsed.nodeModules.global.scanned).toBe(true)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/query',
      source: 'global',
      version: '4.0.0',
    })
  })

  it('resolves a local skill use to a path', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-resolve-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['resolve', '@tanstack/query#fetching'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe('node_modules/@tanstack/query/skills/fetching/SKILL.md')
  })

  it('resolves a skill use as json', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-resolve-json-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main([
      'resolve',
      '@tanstack/query#fetching',
      '--json',
    ])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      package: string
      path: string
      skill: string
      source: 'local' | 'global'
      version: string
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed).toEqual({
      package: '@tanstack/query',
      path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
      skill: 'fetching',
      source: 'local',
      version: '5.0.0',
      warnings: [],
    })
  })

  it('resolves global fallback when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-resolve-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-resolve-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main([
      'resolve',
      '@tanstack/query#fetching',
      '--global',
    ])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe(join(globalPkgDir, 'skills', 'fetching', 'SKILL.md'))
  })

  it('resolves global-only without using local packages', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-resolve-global-only-'),
    )
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-resolve-global-only-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.1.0',
      skillName: 'fetching',
      description: 'Local fetching skill',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main([
      'resolve',
      '@tanstack/query#fetching',
      '--global-only',
      '--json',
    ])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      path: string
      source: 'local' | 'global'
      version: string
    }

    expect(exitCode).toBe(0)
    expect(parsed.source).toBe('global')
    expect(parsed.version).toBe('4.0.0')
    expect(parsed.path).toBe(
      join(globalPkgDir, 'skills', 'fetching', 'SKILL.md'),
    )
  })

  it('fails cleanly for invalid resolve use strings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-resolve-invalid-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['resolve', '@tanstack/query'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Invalid skill use "@tanstack/query": expected <package>#<skill>.',
    )
  })

  it('explains which package version was chosen when conflicts exist', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-conflicts-'))
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
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-'))
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
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
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

  it('validates pnpm workspace package skills from repo root without false packaging warnings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-pnpm-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      keywords: ['tanstack-intent'],
      files: ['skills'],
    })
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
    expect(output).not.toContain(
      '"!skills/_artifacts" is not in the "files" array',
    )
  })

  it('fails cleanly when validate is run without a skills directory', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-missing-skills-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      `Skills directory not found: ${join(root, 'skills')}`,
    )
  })

  it('fails cleanly for unsupported yarn pnp projects', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-pnp-'))
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
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-deno-'))
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
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-mono-'))
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

  it('ignores configured global intent packages when checking staleness', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
      library_version: '5.0.0',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '')

    expect(exitCode).toBe(0)
    expect(output).toBe('[]')
  })

  it('checks only local packages for staleness when globals also exist', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-mixed-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-mixed-global-'),
    )
    tempDirs.push(root, globalRoot)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Local routing skill',
      library_version: '1.0.0',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
      library_version: '5.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
    const reports = JSON.parse(output) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')

    fetchSpy.mockRestore()
  })

  it('checks only the targeted workspace package for staleness', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-target-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'query', 'package.json'), {
      name: '@tanstack/query',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    writeSkillMd(join(root, 'packages', 'query', 'skills', 'cache'), {
      name: 'cache',
      description: 'Caching skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', 'packages/router/skills', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('checks only the targeted workspace package when path omits /skills suffix', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-target-nosuffix-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'query', 'package.json'), {
      name: '@tanstack/query',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    writeSkillMd(join(root, 'packages', 'query', 'skills', 'cache'), {
      name: 'cache',
      description: 'Caching skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', 'packages/router', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('checks the current workspace package for staleness from package cwd', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-package-cwd-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'query', 'package.json'), {
      name: '@tanstack/query',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    writeSkillMd(join(root, 'packages', 'query', 'skills', 'cache'), {
      name: 'cache',
      description: 'Caching skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(join(root, 'packages', 'router'))

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('handles absolute targetDir path correctly', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-abs-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
    })
    writeSkillMd(join(root, 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    const elsewhere = mkdtempSync(join(realTmpdir, 'intent-cli-stale-abs-cwd-'))
    tempDirs.push(elsewhere)
    process.chdir(elsewhere)

    const exitCode = await main(['stale', root, '--json'])
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
