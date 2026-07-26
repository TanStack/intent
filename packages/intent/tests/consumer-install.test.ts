import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInteractiveInstall } from '../src/commands/install/command.js'
import {
  detectInstallTargets,
  readIntentConsumerConfig,
} from '../src/commands/install/config.js'
import { runConsumerInstall } from '../src/commands/install/consumer.js'
import {
  createClackInstallerPrompter,
  groupSkillOptions,
} from '../src/commands/install/prompts.js'
import { runSyncCommand } from '../src/commands/sync/command.js'
import { readInstallState } from '../src/commands/sync/state.js'
import { readIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { scanForIntents } from '../src/discovery/scanner.js'
import type * as ClackPrompts from '@clack/prompts'
import type { InstallerPrompter } from '../src/commands/install/consumer.js'

const clackPromptMocks = vi.hoisted(() => ({
  intro: vi.fn(),
  multiselect: vi.fn<() => Promise<unknown>>(),
  select:
    vi.fn<
      (options: { options: Array<{ value: string }> }) => Promise<unknown>
    >(),
}))

vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof ClackPrompts>()
  return {
    ...actual,
    intro: clackPromptMocks.intro,
    multiselect: clackPromptMocks.multiselect,
    select: clackPromptMocks.select,
  }
})

const roots: Array<string> = []

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

function createProject(): string {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'intent-consumer-install-')),
  )
  roots.push(root)
  writeJson(join(root, 'package.json'), {
    name: 'app',
    private: true,
    devDependencies: { '@tanstack/intent': '0.4.0' },
  })
  const packageRoot = join(root, 'node_modules', '@tanstack', 'query')
  writeJson(join(packageRoot, 'package.json'), {
    name: '@tanstack/query',
    version: '5.0.0',
    intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
  })
  const skillRoot = join(packageRoot, 'skills', 'fetching')
  mkdirSync(skillRoot, { recursive: true })
  writeFileSync(
    join(skillRoot, 'SKILL.md'),
    '---\nname: fetching\ndescription: Query fetching patterns\n---\n',
    'utf8',
  )
  return root
}

function addSkillPackage(
  root: string,
  name: string,
  skills: Array<string>,
): void {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  writeJson(join(packageRoot, 'package.json'), {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: `test/${name}`, docs: 'docs/' },
  })
  for (const skill of skills) {
    const skillRoot = join(packageRoot, 'skills', skill)
    mkdirSync(skillRoot, { recursive: true })
    writeFileSync(
      join(skillRoot, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: ${skill} guidance\n---\n`,
      'utf8',
    )
  }
}

function createPrompts(
  overrides: Partial<InstallerPrompter> = {},
): InstallerPrompter {
  return {
    advisory: () => {},
    complete: () => {},
    selectMethod: () => Promise.resolve('symlink'),
    selectTargets: () => Promise.resolve(['agents']),
    confirmSymlink: () => Promise.resolve(true),
    confirmUserScopeHooks: () => Promise.resolve(true),
    selectSkills: () => Promise.resolve({ mode: 'all-found' }),
    confirmInstall: () => Promise.resolve('install'),
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('consumer install', () => {
  it('detects configured agent targets from project-owned signals', () => {
    const root = createProject()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.cursorrules'), '', 'utf8')

    expect(detectInstallTargets(root)).toEqual(['cursor', 'claude'])
  })

  it('detects no agent targets in a bare project', () => {
    expect(detectInstallTargets(createProject())).toEqual([])
  })

  it('does not detect GitHub Copilot from the .github directory alone', () => {
    const root = createProject()
    mkdirSync(join(root, '.github'))

    expect(detectInstallTargets(root)).toEqual([])
  })

  it('preselects detected targets while keeping every target toggleable', async () => {
    const root = createProject()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.cursorrules'), '', 'utf8')
    clackPromptMocks.multiselect.mockResolvedValueOnce([])

    await createClackInstallerPrompter().selectTargets(
      'symlink',
      detectInstallTargets(root),
    )

    expect(clackPromptMocks.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValues: ['cursor', 'claude'],
        options: expect.arrayContaining([
          expect.objectContaining({ value: 'agents' }),
          expect.objectContaining({ value: 'github' }),
          expect.objectContaining({ value: 'vscode' }),
          expect.objectContaining({ value: 'cursor' }),
          expect.objectContaining({ value: 'codex' }),
          expect.objectContaining({ value: 'claude' }),
        ]),
      }),
    )
  })

  it('groups selectable skills by package', () => {
    const root = createProject()
    const discovered = scanForIntents(root, { scope: 'local' }).packages

    expect(groupSkillOptions(discovered)).toEqual({
      '@tanstack/query': [
        {
          value: '@tanstack/query#fetching',
          label: 'fetching',
          hint: 'Query fetching patterns',
        },
      ],
    })
  })

  it('offers only implemented interactive install methods', async () => {
    clackPromptMocks.select.mockResolvedValueOnce('symlink')

    await createClackInstallerPrompter().selectMethod()

    expect(clackPromptMocks.select).toHaveBeenCalledOnce()
    const [{ options }] = clackPromptMocks.select.mock.calls[0]!
    expect(options.map((option) => option.value)).toEqual(['symlink', 'hooks'])
  })

  it('selects the method before requesting applicable targets', async () => {
    const root = createProject()
    const calls: Array<string> = []
    const prompts = createPrompts({
      selectMethod: () => {
        calls.push('method')
        return Promise.resolve('symlink')
      },
      selectTargets: (method) => {
        calls.push(`targets:${method}`)
        return Promise.resolve(null)
      },
    })

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts,
      root,
    })

    expect(calls).toEqual(['method', 'targets:symlink'])
  })

  it('runs the full interview for an unconfigured project', async () => {
    const root = createProject()
    const selectMethod = vi.fn(() => Promise.resolve('symlink' as const))
    const selectTargets = vi.fn(() =>
      Promise.resolve<Array<'agents'>>(['agents']),
    )
    const selectSkills = vi.fn(() =>
      Promise.resolve({ mode: 'all-found' as const }),
    )

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts({ selectMethod, selectTargets, selectSkills }),
      root,
    })

    expect(selectMethod).toHaveBeenCalledOnce()
    expect(selectTargets).toHaveBeenCalledOnce()
    expect(selectSkills).toHaveBeenCalledOnce()
  })

  it('reports an already-configured project as up to date without interviewing', async () => {
    const root = createProject()
    const discovered = scanForIntents(root, { scope: 'local' }).packages
    await runConsumerInstall({ discovered, prompts: createPrompts(), root })
    const complete = vi.fn()
    const selectMethod = vi.fn(() =>
      Promise.reject(new Error('method must not run')),
    )
    const selectTargets = vi.fn(() =>
      Promise.reject(new Error('targets must not run')),
    )
    const selectSkills = vi.fn(() =>
      Promise.reject(new Error('skills must not run')),
    )
    const prompts = createPrompts({
      complete,
      selectMethod,
      selectTargets,
      selectSkills,
    })

    await runConsumerInstall({ discovered, prompts, root })

    expect(complete).toHaveBeenCalledWith('Project is up to date.')
    expect(selectMethod).not.toHaveBeenCalled()
    expect(selectTargets).not.toHaveBeenCalled()
    expect(selectSkills).not.toHaveBeenCalled()
  })

  it('reports a new skill and enters review without re-interviewing delivery', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    const skillRoot = join(
      root,
      'node_modules',
      '@tanstack',
      'query',
      'skills',
      'mutations',
    )
    mkdirSync(skillRoot, { recursive: true })
    writeFileSync(
      join(skillRoot, 'SKILL.md'),
      '---\nname: mutations\ndescription: Query mutation patterns\n---\n',
      'utf8',
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const selectSkills = vi.fn(() =>
      Promise.resolve({ mode: 'all-found' as const }),
    )
    const confirmInstall = vi.fn(() => Promise.resolve('install' as const))
    const prompts = createPrompts({
      selectMethod: () => Promise.reject(new Error('method must not run')),
      selectTargets: () => Promise.reject(new Error('targets must not run')),
      selectSkills,
      confirmInstall,
    })

    try {
      await runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        prompts,
        root,
      })

      expect(log.mock.calls.flat().join('\n')).toContain(
        'Install changes: 0 new dependencies, 1 new skill, 0 changed, 0 removed.',
      )
    } finally {
      log.mockRestore()
    }
    expect(selectSkills).toHaveBeenCalledOnce()
    expect(confirmInstall).toHaveBeenCalledOnce()
  })

  it('installs confirmed skills with policy, lock state, and managed links', async () => {
    const root = createProject()
    const advisory = vi.fn()
    const prompts = createPrompts({ advisory })

    await runInteractiveInstall({
      cwd: root,
      prompts,
    })

    expect(
      readIntentConsumerConfig(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ),
    ).toEqual({
      skills: ['@tanstack/query'],
      exclude: [],
      install: { method: 'symlink', targets: ['agents'] },
    })
    expect(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts,
    ).toEqual({ prepare: 'intent sync' })
    expect(readIntentLockfile(join(root, 'intent.lock'))).toMatchObject({
      status: 'found',
      lockfile: {
        sources: [
          {
            kind: 'npm',
            id: '@tanstack/query',
            skills: [
              {
                path: 'skills/fetching',
                contentHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
              },
            ],
          },
        ],
      },
    })
    const link = join(root, '.agents', 'skills', 'npm-tanstack-query-fetching')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readInstallState(root)).toMatchObject({
      status: 'found',
      state: {
        entries: [{ path: '.agents/skills/npm-tanstack-query-fetching' }],
      },
    })
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    expect(advisory).not.toHaveBeenCalled()
  })

  it('installs hooks with policy and lock state without links or prepare', async () => {
    const root = createProject()
    const prompts = createPrompts({
      selectMethod: () => Promise.resolve('hooks'),
      selectTargets: () => Promise.resolve(['claude', 'codex']),
      confirmSymlink: () =>
        Promise.reject(new Error('hooks must not request symlink consent')),
    })

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts,
      root,
    })

    expect(
      readIntentConsumerConfig(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ),
    ).toEqual({
      skills: ['@tanstack/query'],
      exclude: [],
      install: { method: 'hooks', targets: ['claude', 'codex'] },
    })
    expect(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts,
    ).toBeUndefined()
    expect(readIntentLockfile(join(root, 'intent.lock'))).toMatchObject({
      status: 'found',
      lockfile: {
        sources: [
          {
            id: '@tanstack/query',
            skills: [{ path: 'skills/fetching' }],
          },
        ],
      },
    })
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(root, '.codex', 'hooks.json'))).toBe(true)
    expect(existsSync(join(root, '.agents'))).toBe(false)
    expect(readInstallState(root)).toEqual({ status: 'missing' })
  })

  it('installs selected GitHub hooks at user scope after confirmation', async () => {
    const root = createProject()
    const copilotHome = join(root, 'copilot-home')
    const previousCopilotHome = process.env.COPILOT_HOME
    const confirmUserScopeHooks = vi.fn(() => Promise.resolve(true))
    let output = ''
    const prompts = createPrompts({
      complete(message) {
        output = message
      },
      selectMethod: () => Promise.resolve('hooks'),
      selectTargets: () => Promise.resolve(['github']),
      confirmUserScopeHooks,
    })
    process.env.COPILOT_HOME = copilotHome

    try {
      await runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        prompts,
        root,
      })
    } finally {
      if (previousCopilotHome === undefined) {
        delete process.env.COPILOT_HOME
      } else {
        process.env.COPILOT_HOME = previousCopilotHome
      }
    }

    expect(confirmUserScopeHooks).toHaveBeenCalledOnce()
    expect(existsSync(join(copilotHome, 'hooks', 'hooks.json'))).toBe(true)
    expect(output).toContain('Installed hook agents: copilot.')
  })

  it('skips declined Copilot hooks while installing project hooks', async () => {
    const root = createProject()
    const copilotHome = join(root, 'copilot-home')
    const previousCopilotHome = process.env.COPILOT_HOME
    let output = ''
    const prompts = createPrompts({
      complete(message) {
        output = message
      },
      selectMethod: () => Promise.resolve('hooks'),
      selectTargets: () => Promise.resolve(['github', 'claude', 'codex']),
      confirmUserScopeHooks: () => Promise.resolve(false),
    })
    process.env.COPILOT_HOME = copilotHome

    try {
      await runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        prompts,
        root,
      })
    } finally {
      if (previousCopilotHome === undefined) {
        delete process.env.COPILOT_HOME
      } else {
        process.env.COPILOT_HOME = previousCopilotHome
      }
    }

    expect(existsSync(join(copilotHome, 'hooks', 'hooks.json'))).toBe(false)
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(root, '.codex', 'hooks.json'))).toBe(true)
    expect(output).toContain('Installed hook agents: claude, codex.')
    expect(output).toContain(
      'Copilot was skipped because home-directory access was declined.',
    )
  })

  it('writes nothing when installation is cancelled', async () => {
    const root = createProject()
    const originalPackageJson = readFileSync(join(root, 'package.json'), 'utf8')
    const prompts = createPrompts({
      confirmInstall: () => Promise.resolve(null),
    })

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts,
      root,
    })

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      originalPackageJson,
    )
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, '.agents'))).toBe(false)
  })

  it('locks and links selected skills without excluding unchecked siblings', async () => {
    const root = createProject()
    const packageRoot = join(root, 'node_modules', '@tanstack', 'query')
    const sibling = join(packageRoot, 'skills', 'mutations')
    mkdirSync(sibling, { recursive: true })
    writeFileSync(
      join(sibling, 'SKILL.md'),
      '---\nname: mutations\ndescription: Query mutation patterns\n---\n',
      'utf8',
    )
    const prompts = createPrompts({
      selectSkills: () =>
        Promise.resolve({
          mode: 'individual',
          enabled: ['@tanstack/query#fetching'],
        }),
    })

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts,
      root,
    })

    const config = readIntentConsumerConfig(
      readFileSync(join(root, 'package.json'), 'utf8'),
    )
    expect(config.skills).toEqual(['@tanstack/query#fetching'])
    expect(config.exclude).toEqual([])
    const lock = readIntentLockfile(join(root, 'intent.lock'))
    expect(
      lock.status === 'found' ? lock.lockfile.sources[0]?.skills : [],
    ).toEqual([
      {
        path: 'skills/fetching',
        contentHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
      },
    ])
    expect(
      existsSync(
        join(root, '.agents', 'skills', 'npm-tanstack-query-mutations'),
      ),
    ).toBe(false)
  })

  it('prints the complete plan without writing during dry run', async () => {
    const root = createProject()
    const originalPackageJson = readFileSync(join(root, 'package.json'), 'utf8')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let output = ''
    const prompts = createPrompts()

    try {
      await runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        dryRun: true,
        prompts,
        root,
      })
      output = log.mock.calls.flat().join('\n')
    } finally {
      log.mockRestore()
    }

    expect(output).toContain(
      'Would install 1 skill to Shared .agents directory using symlink.',
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      originalPackageJson,
    )
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, '.agents'))).toBe(false)
  })

  it('prints the hooks plan without writing or requesting home access', async () => {
    const root = createProject()
    const originalPackageJson = readFileSync(join(root, 'package.json'), 'utf8')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let output = ''
    const prompts = createPrompts({
      selectMethod: () => Promise.resolve('hooks'),
      selectTargets: () => Promise.resolve(['github']),
      confirmUserScopeHooks: () =>
        Promise.reject(new Error('dry run must not request home access')),
    })

    try {
      await runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        dryRun: true,
        prompts,
        root,
      })
      output = log.mock.calls.flat().join('\n')
    } finally {
      log.mockRestore()
    }

    expect(output).toContain(
      'Would install 1 skill to GitHub Copilot using hooks.',
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      originalPackageJson,
    )
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, '.copilot'))).toBe(false)
  })

  it('installs without Intent as a project development dependency', async () => {
    const root = createProject()
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    const advisory = vi.fn()
    const prompts = createPrompts({ advisory })

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts,
      root,
    })

    expect(
      readIntentConsumerConfig(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ),
    ).toEqual({
      skills: ['@tanstack/query'],
      exclude: [],
      install: { method: 'symlink', targets: ['agents'] },
    })
    expect(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts,
    ).toBeUndefined()
    expect(readIntentLockfile(join(root, 'intent.lock'))).toMatchObject({
      status: 'found',
      lockfile: {
        sources: [
          {
            id: '@tanstack/query',
            skills: [{ path: 'skills/fetching' }],
          },
        ],
      },
    })
    expect(advisory).toHaveBeenCalledWith(
      'Skills will not re-sync automatically because the prepare script was not wired. intent.lock records the accepted skill baseline, but nothing will check it automatically. Add @tanstack/intent as a devDependency to enable both.',
    )
  })

  it('stops without skill selection when discovery is empty', async () => {
    const root = createProject()
    rmSync(join(root, 'node_modules', '@tanstack', 'query'), {
      recursive: true,
      force: true,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let output = ''
    const prompts = createPrompts({
      complete(message) {
        output = message
      },
      selectSkills: () =>
        Promise.reject(new Error('skill selection must not run')),
    })

    try {
      await runConsumerInstall({ discovered: [], prompts, root })
    } finally {
      log.mockRestore()
    }

    expect(output).toContain('No intent-enabled skills found.')
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
  })

  it('does not write configuration when a delivery target conflicts', async () => {
    const root = createProject()
    const originalPackageJson = readFileSync(join(root, 'package.json'), 'utf8')
    const target = join(
      root,
      '.agents',
      'skills',
      'npm-tanstack-query-fetching',
    )
    mkdirSync(target, { recursive: true })

    await expect(
      runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        prompts: createPrompts(),
        root,
      }),
    ).rejects.toThrow('Install target conflicts')

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      originalPackageJson,
    )
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(lstatSync(target).isDirectory()).toBe(true)
  })

  it('restarts choices when final confirmation goes back', async () => {
    const root = createProject()
    const targets = [['agents'], ['cursor']] as const
    let pass = 0
    const prompts = createPrompts({
      selectTargets: () =>
        Promise.resolve([...targets[pass]!] as Array<'agents' | 'cursor'>),
      confirmInstall: () => {
        pass += 1
        return Promise.resolve(pass === 1 ? 'back' : 'install')
      },
    })

    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts,
      root,
    })

    expect(
      readIntentConsumerConfig(readFileSync(join(root, 'package.json'), 'utf8'))
        .install,
    ).toEqual({ method: 'symlink', targets: ['cursor'] })
    expect(
      existsSync(
        join(root, '.cursor', 'skills', 'npm-tanstack-query-fetching'),
      ),
    ).toBe(true)
    expect(existsSync(join(root, '.agents'))).toBe(false)
  })

  it('reviews and installs selected skills from new dependencies', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    addSkillPackage(root, '@tanstack/new-package', ['first', 'second'])

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('review'),
          selectSkills: () =>
            Promise.resolve({
              mode: 'individual',
              enabled: ['@tanstack/new-package#first'],
            }),
        },
      },
    )

    const config = readIntentConsumerConfig(
      readFileSync(join(root, 'package.json'), 'utf8'),
    )
    expect(config.skills).toEqual([
      '@tanstack/new-package#first',
      '@tanstack/query',
    ])
    expect(config.exclude).toEqual([])
    expect(readIntentLockfile(join(root, 'intent.lock'))).toMatchObject({
      status: 'found',
      lockfile: {
        sources: [
          { id: '@tanstack/new-package', skills: [{ path: 'skills/first' }] },
          { id: '@tanstack/query' },
        ],
      },
    })
    expect(
      existsSync(
        join(root, '.agents', 'skills', 'npm-tanstack-new-package-first'),
      ),
    ).toBe(true)
    expect(
      existsSync(
        join(root, '.agents', 'skills', 'npm-tanstack-new-package-second'),
      ),
    ).toBe(false)
  })

  it('adds accepted skills beside an existing skill-level entry', async () => {
    const root = createProject()
    addSkillPackage(root, 'demo-pkg', ['alpha'])
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    const packageJsonPath = join(root, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    packageJson.intent.skills = ['demo-pkg#alpha']
    packageJson.intent.exclude = ['@tanstack/query']
    writeJson(packageJsonPath, packageJson)
    addSkillPackage(root, 'demo-pkg', ['alpha', 'beta'])

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('review'),
          selectSkills: () =>
            Promise.resolve({
              mode: 'individual',
              enabled: ['demo-pkg#beta'],
            }),
        },
      },
    )

    expect(
      readIntentConsumerConfig(readFileSync(packageJsonPath, 'utf8')).skills,
    ).toEqual(['demo-pkg#alpha', 'demo-pkg#beta'])
    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-alpha')),
    ).toBe(true)
    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-beta')),
    ).toBe(true)
  })

  it('keeps an existing package-level entry when accepting a new skill', async () => {
    const root = createProject()
    addSkillPackage(root, 'demo-pkg', ['alpha', 'beta'])
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    const packageJsonPath = join(root, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    packageJson.intent.skills = ['demo-pkg']
    packageJson.intent.exclude = ['@tanstack/query']
    writeJson(packageJsonPath, packageJson)

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('review'),
          selectSkills: () =>
            Promise.resolve({
              mode: 'individual',
              enabled: ['demo-pkg#beta'],
            }),
        },
      },
    )

    expect(
      readIntentConsumerConfig(readFileSync(packageJsonPath, 'utf8')).skills,
    ).toEqual(['demo-pkg'])
    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-alpha')),
    ).toBe(true)
    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-beta')),
    ).toBe(true)
  })

  it('writes a package-level entry when all skills in a new package are accepted', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    addSkillPackage(root, 'demo-pkg', ['alpha', 'beta'])

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('review'),
          selectSkills: () =>
            Promise.resolve({
              mode: 'individual',
              enabled: ['demo-pkg#alpha', 'demo-pkg#beta'],
            }),
        },
      },
    )

    const config = readIntentConsumerConfig(
      readFileSync(join(root, 'package.json'), 'utf8'),
    )
    expect(config.skills).toContain('demo-pkg')
    expect(config.skills).not.toContain('demo-pkg#alpha')
    expect(config.skills).not.toContain('demo-pkg#beta')
    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-alpha')),
    ).toBe(true)
    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-beta')),
    ).toBe(true)
  })

  it('excludes new dependencies without changing the lock', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    addSkillPackage(root, 'declined-package', ['declined'])
    const lockBefore = readFileSync(join(root, 'intent.lock'), 'utf8')

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('exclude'),
          selectSkills: () => Promise.resolve(null),
        },
      },
    )

    expect(
      readIntentConsumerConfig(readFileSync(join(root, 'package.json'), 'utf8'))
        .exclude,
    ).toEqual(['declined-package'])
    expect(readFileSync(join(root, 'intent.lock'), 'utf8')).toBe(lockBefore)
  })

  it('excludes only new skills from a partially allowed package', async () => {
    const root = createProject()
    addSkillPackage(root, 'demo-pkg', ['alpha'])
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    const packageJsonPath = join(root, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    packageJson.intent.skills = ['@tanstack/query', 'demo-pkg#alpha']
    writeJson(packageJsonPath, packageJson)
    addSkillPackage(root, 'demo-pkg', ['alpha', 'beta'])

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('exclude'),
          selectSkills: () => Promise.resolve(null),
        },
      },
    )

    const config = readIntentConsumerConfig(
      readFileSync(packageJsonPath, 'utf8'),
    )
    expect(config.exclude).toContain('demo-pkg#beta')
    expect(config.exclude).not.toContain('demo-pkg')

    await runSyncCommand({ cwd: root }, { review: 'reminder' })

    expect(
      existsSync(join(root, '.agents', 'skills', 'npm-demo-pkg-alpha')),
    ).toBe(true)
  })

  it('fails non-interactive sync for a pending dependency without accepting it', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    addSkillPackage(root, 'pending-package', ['pending'])
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')
    const lockBefore = readFileSync(join(root, 'intent.lock'), 'utf8')

    await expect(
      runSyncCommand({ cwd: root }, { review: 'fail' }),
    ).rejects.toThrow(
      'Intent sync requires review before automation can continue.',
    )

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageBefore)
    expect(readFileSync(join(root, 'intent.lock'), 'utf8')).toBe(lockBefore)
  })

  it('fails non-interactive sync for a new skill in an enabled package without accepting it', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    const skillRoot = join(
      root,
      'node_modules',
      '@tanstack',
      'query',
      'skills',
      'mutation',
    )
    mkdirSync(skillRoot, { recursive: true })
    writeFileSync(
      join(skillRoot, 'SKILL.md'),
      '---\nname: mutation\ndescription: Mutation guidance\n---\n',
      'utf8',
    )
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')
    const lockBefore = readFileSync(join(root, 'intent.lock'), 'utf8')

    await expect(
      runSyncCommand({ cwd: root }, { review: 'fail' }),
    ).rejects.toThrow(
      'Intent sync requires review before automation can continue.',
    )

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageBefore)
    expect(readFileSync(join(root, 'intent.lock'), 'utf8')).toBe(lockBefore)
  })

  it('fails non-interactive sync for changed content without accepting it', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    writeFileSync(
      join(
        root,
        'node_modules',
        '@tanstack',
        'query',
        'skills',
        'fetching',
        'SKILL.md',
      ),
      '---\nname: fetching\ndescription: Changed guidance\n---\n',
      'utf8',
    )
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')
    const lockBefore = readFileSync(join(root, 'intent.lock'), 'utf8')

    await expect(
      runSyncCommand({ cwd: root }, { review: 'fail' }),
    ).rejects.toThrow(
      'Intent sync requires review before automation can continue.',
    )

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageBefore)
    expect(readFileSync(join(root, 'intent.lock'), 'utf8')).toBe(lockBefore)
  })

  it('leaves new dependencies pending when review is deferred', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    addSkillPackage(root, 'later-package', ['later'])
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')
    const lockBefore = readFileSync(join(root, 'intent.lock'), 'utf8')

    await runSyncCommand(
      { cwd: root },
      {
        review: 'interactive',
        prompts: {
          complete: () => {},
          reviewNewDependencies: () => Promise.resolve('later'),
          selectSkills: () => Promise.resolve(null),
        },
      },
    )

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageBefore)
    expect(readFileSync(join(root, 'intent.lock'), 'utf8')).toBe(lockBefore)
  })

  it('keeps prepare sync prompt-free and reminder-only', async () => {
    const root = createProject()
    await runConsumerInstall({
      discovered: scanForIntents(root, { scope: 'local' }).packages,
      prompts: createPrompts(),
      root,
    })
    addSkillPackage(root, 'prepare-package', ['prepare-skill'])
    const packageBefore = readFileSync(join(root, 'package.json'), 'utf8')
    const lockBefore = readFileSync(join(root, 'intent.lock'), 'utf8')
    const previousLifecycle = process.env.npm_lifecycle_event
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let output = ''
    process.env.npm_lifecycle_event = 'prepare'

    try {
      await runSyncCommand(
        { cwd: root },
        {
          review: 'interactive',
          prompts: {
            complete: () => {},
            reviewNewDependencies: () =>
              Promise.reject(new Error('prepare must not prompt')),
            selectSkills: () =>
              Promise.reject(new Error('prepare must not select skills')),
          },
        },
      )
      output = log.mock.calls.flat().join('\n')
    } finally {
      log.mockRestore()
      if (previousLifecycle === undefined) {
        delete process.env.npm_lifecycle_event
      } else {
        process.env.npm_lifecycle_event = previousLifecycle
      }
    }

    expect(output).toContain('New dependencies with skills found:')
    expect(output).toContain('prepare-package  1 skill')
    expect(output).toContain('Run `intent install` to review and install them')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(packageBefore)
    expect(readFileSync(join(root, 'intent.lock'), 'utf8')).toBe(lockBefore)
  })
})
