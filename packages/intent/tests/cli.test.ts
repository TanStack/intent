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
import { runLoadCommand } from '../src/commands/load.js'
import { main } from '../src/cli.js'
import type { ScanOptions, ScanResult } from '../src/types.js'

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
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
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
  stdoutWriteSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)
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
  stdoutWriteSpy.mockRestore()
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

  it('writes skill loading guidance by default and is idempotent', async () => {
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
    expect(output).toContain('Created AGENTS.md with skill loading guidance.')
    expect(content).toContain('## Skill Loading')
    expect(content).toContain('npx @tanstack/intent@latest list')
    expect(content).toContain('if one local skill clearly matches the task')
    expect(content).toContain('Monorepos:')
    expect(content).toContain('Multiple matches:')
    expect(content).not.toContain('--global')
    expect(content).not.toContain('use: "@tanstack/query#fetching"')
    expect(content).not.toContain(root)
    expect(output).toContain(
      'Tip: Keep the intent-skills block near the top of AGENTS.md',
    )

    logSpy.mockClear()

    const secondExitCode = await main(['install'])
    const secondOutput = logSpy.mock.calls.flat().join('\n')

    expect(secondExitCode).toBe(0)
    expect(secondOutput).toContain(
      'No changes to AGENTS.md; skill loading guidance already current.',
    )
    expect(readFileSync(agentsPath, 'utf8')).toBe(content)
  })

  it('prints generated skill loading guidance without writing during dry run', async () => {
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
    expect(output).toContain('Generated skill loading guidance for AGENTS.md.')
    expect(output).toContain('npx @tanstack/intent@latest list')
    expect(output).toContain(
      'npx @tanstack/intent@latest load <package>#<skill>',
    )
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('writes skill loading guidance even with no discovered skills', async () => {
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
    expect(output).toContain('Created AGENTS.md with skill loading guidance.')
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain(
      'npx @tanstack/intent@latest list',
    )
  })

  it('writes install mappings with --map and is idempotent', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-map-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-map-empty-global-'),
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

    const exitCode = await main(['install', '--map'])
    const agentsPath = join(root, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf8')
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Created AGENTS.md with 1 mapping.')
    expect(content).toContain('when: "Query data fetching patterns"')
    expect(content).toContain('use: "@tanstack/query#fetching"')
    expect(content).not.toContain('load:')
    expect(content).not.toContain(root)

    logSpy.mockClear()

    const secondExitCode = await main(['install', '--map'])
    const secondOutput = logSpy.mock.calls.flat().join('\n')

    expect(secondExitCode).toBe(0)
    expect(secondOutput).toContain(
      'No changes to AGENTS.md; 1 mapping already current.',
    )
    expect(readFileSync(agentsPath, 'utf8')).toBe(content)
  })

  it('ignores configured global packages during install --map by default', async () => {
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

    const exitCode = await main(['install', '--map', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('No intent-enabled skills found.')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('includes configured global packages during install --map when requested', async () => {
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

    const exitCode = await main(['install', '--map', '--global', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Generated 1 mapping for AGENTS.md.')
    expect(output).toContain('when: "Global fetching skill"')
    expect(output).toContain('use: "@tanstack/query#fetching"')
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

  it('copies github workflow templates with the setup alias', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-setup-alias-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@scope/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'scope/pkg', docs: 'docs/' },
    })

    process.chdir(root)

    const exitCode = await main(['setup'])
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
      'Lookup: Runtime lookup only: run `npx @tanstack/intent@latest load @tanstack/query#fetching --path`, and load its reported path for this session. Do not copy the resolved path into this file.',
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

  it('rejects --global and --global-only together on list', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-mutual-excl-list-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['list', '--global', '--global-only'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Use either --global or --global-only, not both.',
    )
  })

  it('rejects --global and --global-only together on install', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-mutual-excl-install-'),
    )
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['install', '--global', '--global-only'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Use either --global or --global-only, not both.',
    )
  })

  it('rejects --global and --global-only together on load', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-mutual-excl-load-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main([
      'load',
      '@tanstack/query#core',
      '--global',
      '--global-only',
    ])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Use either --global or --global-only, not both.',
    )
  })

  it('loads a local skill use as markdown', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching'])
    const output = stdoutWriteSpy.mock.calls.flat().join('')

    expect(exitCode).toBe(0)
    expect(output).toContain('Skill content here.')
  })

  it('loads a local skill use to a path with --path', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-path-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching', '--path'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe('node_modules/@tanstack/query/skills/fetching/SKILL.md')
  })

  it('loads a skill use as json', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-json-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      package: string
      content: string
      path: string
      packageRoot: string
      skill: string
      source: 'local' | 'global'
      version: string
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed).toEqual({
      package: '@tanstack/query',
      content: expect.stringContaining('Skill content here.'),
      path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
      packageRoot: join(root, 'node_modules', '@tanstack', 'query'),
      skill: 'fetching',
      source: 'local',
      version: '5.0.0',
      warnings: [],
    })
  })

  it('loads global fallback path when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-load-global-node-modules-'),
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
      'load',
      '@tanstack/query#fetching',
      '--global',
      '--path',
    ])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe(join(globalPkgDir, 'skills', 'fetching', 'SKILL.md'))
  })

  it('loads global-only without using local packages', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-global-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-load-global-only-node-modules-'),
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
      'load',
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

  it('fails cleanly for invalid load use strings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-invalid-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Invalid skill use "@tanstack/query": expected <package>#<skill>.',
    )
  })

  it('validates load use strings before scanning', async () => {
    const scanSpy = vi.fn(
      async (_options?: ScanOptions): Promise<ScanResult> => {
        throw new Error('should not scan')
      },
    )

    await expect(
      runLoadCommand('@tanstack/query', {}, scanSpy),
    ).rejects.toThrow(
      'Invalid skill use "@tanstack/query": expected <package>#<skill>.',
    )
    expect(scanSpy).not.toHaveBeenCalled()
  })

  it('fails cleanly when load cannot find the package', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-load-missing-package-'),
    )
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Cannot resolve skill use "@tanstack/query#fetching": package "@tanstack/query" was not found.',
    )
  })

  it('fails cleanly when load cannot find the skill', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-missing-skill-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#mutations'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Cannot resolve skill use "@tanstack/query#mutations": skill "mutations" was not found in package "@tanstack/query". Available skills: fetching.',
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

  it('validates nested pnpm workspace package skills from the repo root', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-nested-pnpm-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/typescript/*\n',
    )

    for (const packageName of ['ai', 'ai-code-mode']) {
      const packageDir = join(root, 'packages', 'typescript', packageName)
      writeJson(join(packageDir, 'package.json'), {
        name: `@tanstack/${packageName}`,
        devDependencies: { '@tanstack/intent': '^0.0.18' },
        keywords: ['tanstack-intent'],
        files: ['skills'],
      })
      writeSkillMd(join(packageDir, 'skills', 'core'), {
        name: 'core',
        description: `${packageName} skill`,
      })
    }

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 2 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
    expect(output).not.toContain('Missing "tanstack-intent" in keywords array')
  })

  it('validates nested package.json workspace package skills from the repo root', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-nested-yarn-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/typescript/*'],
    })

    for (const packageName of ['ai', 'ai-code-mode']) {
      const packageDir = join(root, 'packages', 'typescript', packageName)
      writeJson(join(packageDir, 'package.json'), {
        name: `@tanstack/${packageName}`,
        devDependencies: { '@tanstack/intent': '^0.0.18' },
        keywords: ['tanstack-intent'],
        files: ['skills'],
      })
      writeSkillMd(join(packageDir, 'skills', 'core'), {
        name: 'core',
        description: `${packageName} skill`,
      })
    }

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 2 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
    expect(output).not.toContain('Missing "tanstack-intent" in keywords array')
  })

  it('validates only the explicit skills directory when one is passed', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-explicit-nested-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/typescript/*'],
    })
    writeJson(join(root, 'packages', 'typescript', 'ai', 'package.json'), {
      name: '@tanstack/ai',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      keywords: ['tanstack-intent'],
      files: ['skills'],
    })
    writeJson(
      join(root, 'packages', 'typescript', 'ai-code-mode', 'package.json'),
      {
        name: '@tanstack/ai-code-mode',
        devDependencies: { '@tanstack/intent': '^0.0.18' },
        keywords: ['tanstack-intent'],
        files: ['skills'],
      },
    )
    writeSkillMd(join(root, 'packages', 'typescript', 'ai', 'skills', 'core'), {
      name: 'core',
      description: 'AI skill',
    })
    writeSkillMd(
      join(root, 'packages', 'typescript', 'ai-code-mode', 'skills', 'bad'),
      {
        name: 'not-bad',
        description: 'Invalid skill outside the explicit target',
      },
    )

    process.chdir(root)

    const exitCode = await main([
      'validate',
      'packages/typescript/ai/skills',
    ])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('not-bad')
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

  it('skips cleanly when validate is run without a skills directory', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-missing-skills-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      'No skills/ directory found — skipping validation.',
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('writes a GitHub summary when validation fails', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-summary-'))
    tempDirs.push(root)
    const previousSummary = process.env.GITHUB_STEP_SUMMARY
    const summaryPath = join(root, 'summary.md')
    writeSkillMd(join(root, 'skills', 'db-core'), {
      name: 'wrong-name',
      description: 'Core database concepts',
    })
    process.chdir(root)
    process.env.GITHUB_STEP_SUMMARY = summaryPath

    try {
      const exitCode = await main(['validate', '--github-summary'])
      const summary = readFileSync(summaryPath, 'utf8')

      expect(exitCode).toBe(1)
      expect(summary).toContain('Skill validation failed.')
      expect(summary).toContain('Why this failed:')
      expect(summary).toContain(
        'name "wrong-name" does not match directory path "db-core"',
      )
    } finally {
      if (previousSummary === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummary
      }
    }
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
      'Installed-package scanning in Yarn PnP projects without node_modules is not yet supported. `intent validate` can still validate workspace skills; for list/load/install, add `nodeLinker: node-modules` to .yarnrc.yml or use --global-only.',
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

  it('prefers workspace package staleness when the workspace root has a skills directory', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-root-skills-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    mkdirSync(join(root, 'skills'), { recursive: true })
    writeJson(join(root, 'packages', 'router-core', 'package.json'), {
      name: '@tanstack/router-core',
    })
    writeSkillMd(
      join(root, 'packages', 'router-core', 'skills', 'router-core'),
      {
        name: 'router-core',
        description: 'Router core skill',
        library_version: '1.0.0',
      },
    )
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills:',
        "  - name: 'Router Core'",
        "    slug: 'router-core'",
        "    path: 'skills/router-core/SKILL.md'",
        "    package: 'packages/router-core'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      library: string
      signals?: Array<{
        type: string
        skill?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(reports.map((report) => report.library)).toEqual([
      '@tanstack/router-core',
    ])
    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'artifact-skill-missing',
          skill: 'router-core',
        }),
      ]),
    )

    fetchSpy.mockRestore()
  })

  it('flags workspace packages missing skill and artifact coverage', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-coverage-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills:',
        "  - name: 'Routing'",
        "    slug: 'routing'",
        "    path: 'packages/router/skills/routing/SKILL.md'",
        "    package: 'packages/router'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(signals).toEqual([
      expect.objectContaining({
        type: 'missing-package-coverage',
        packageName: '@tanstack/react-start-rsc',
      }),
    ])

    fetchSpy.mockRestore()
  })

  it('does not flag workspace packages ignored in artifact coverage', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-coverage-ignore-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'coverage:',
        '  ignored_packages:',
        "    - '@tanstack/react-start-rsc'",
        'skills:',
        "  - name: 'Routing'",
        "    slug: 'routing'",
        "    path: 'packages/router/skills/routing/SKILL.md'",
        "    package: 'packages/router'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'missing-package-coverage',
          packageName: '@tanstack/react-start-rsc',
        }),
      ]),
    )

    fetchSpy.mockRestore()
  })

  it('does not flag private workspace packages as missing coverage', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-private-coverage-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*', 'examples/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'examples', 'start-rsc', 'package.json'), {
      name: 'start-rsc-example',
      private: true,
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills:',
        "  - name: 'Routing'",
        "    slug: 'routing'",
        "    path: 'packages/router/skills/routing/SKILL.md'",
        "    package: 'packages/router'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(signals).toEqual([
      expect.objectContaining({
        type: 'missing-package-coverage',
        packageName: '@tanstack/react-start-rsc',
      }),
    ])
    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'missing-package-coverage',
          packageName: 'start-rsc-example',
        }),
      ]),
    )

    fetchSpy.mockRestore()
  })

  it('flags missing coverage even when no workspace package has generated skills yet', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-all-missing-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills: []',
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.signals).toEqual([
      expect.objectContaining({
        type: 'missing-package-coverage',
        packageName: '@tanstack/react-start-rsc',
      }),
    ])

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
