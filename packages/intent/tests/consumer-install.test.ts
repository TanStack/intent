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
import { runConsumerInstall } from '../src/commands/install/consumer.js'
import { readIntentConsumerConfig } from '../src/commands/install/config.js'
import { readInstallState } from '../src/commands/sync/state.js'
import { readIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { scanForIntents } from '../src/discovery/scanner.js'
import type { InstallerPrompter } from '../src/commands/install/consumer.js'

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

function createPrompts(
  overrides: Partial<InstallerPrompter> = {},
): InstallerPrompter {
  return {
    complete: () => {},
    selectTargets: () => Promise.resolve(['agents']),
    selectMethod: () => Promise.resolve('symlink'),
    confirmSymlink: () => Promise.resolve(true),
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
  it('installs confirmed skills with policy, lock state, and managed links', async () => {
    const root = createProject()
    const prompts = createPrompts()

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

  it('locks and links selected skills while excluding unchecked siblings', async () => {
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
    expect(config.exclude).toEqual(['@tanstack/query#mutations'])
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

  it('requires Intent as a project development dependency', async () => {
    const root = createProject()
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    const prompts = createPrompts()

    await expect(
      runConsumerInstall({
        discovered: scanForIntents(root, { scope: 'local' }).packages,
        prompts,
        root,
      }),
    ).rejects.toThrow(
      '@tanstack/intent must be installed as a project devDependency before running `intent install`.',
    )
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
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
})
