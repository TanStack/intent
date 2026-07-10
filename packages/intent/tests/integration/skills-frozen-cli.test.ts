import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateManifest,
  writeIntentManifest,
} from '../../src/core/manifest.js'

const thisDir = dirname(fileURLToPath(import.meta.url))
const cliPath = join(thisDir, '..', '..', 'dist', 'cli.mjs')
const roots: Array<string> = []

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeSkillPackage(
  root: string,
  name: string,
  content = 'Guidance.',
): string {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  writeJson(join(packageRoot, 'package.json'), {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: `test/${name}`, docs: 'docs/' },
  })
  mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
  writeFileSync(
    join(packageRoot, 'skills', 'core', 'SKILL.md'),
    `---\nname: core\ndescription: ${name} skill\n---\n\n${content}\n`,
  )
  return packageRoot
}

function writeManifest(
  root: string,
  name: string,
  capabilities: Array<'uses_network'> = [],
): void {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  const outcome = generateManifest(packageRoot, name, '1.0.0', [
    {
      name: 'core',
      path: join(packageRoot, 'skills', 'core', 'SKILL.md'),
      description: `${name} skill`,
    },
  ])
  if (!outcome.ok) {
    throw new Error('Fixture manifest unexpectedly contains a secret.')
  }
  outcome.manifest.skills[0]!.capabilities = capabilities
  writeIntentManifest(
    join(packageRoot, 'skills', 'intent.manifest.json'),
    outcome.manifest,
  )
}

function writeProject(root: string, skills: Array<string>): void {
  writeJson(join(root, 'package.json'), {
    name: 'frozen-cli-fixture',
    private: true,
    intent: { skills },
  })
}

function createProject(skills: Array<string> = ['foo']): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-frozen-cli-'))
  roots.push(root)
  writeProject(root, skills)
  writeSkillPackage(root, 'foo')
  return root
}

function runCommand(root: string, args: Array<string>): number | null {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '', INTENT_FROZEN: '' },
    timeout: 30_000,
  }).status
}

function runCli(root: string, args: Array<string>): number | null {
  return runCommand(root, ['skills', ...args])
}

function approveInitialLock(root: string): void {
  expect(runCli(root, ['approve', '--all', '--yes'])).toBe(0)
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('built CLI frozen mode', () => {
  it('fails when intent.lock is missing', () => {
    expect(runCli(createProject(), ['scan', '--frozen'])).toBe(4)
  })

  it('fails when intent.lock is malformed', () => {
    const root = createProject()
    writeFileSync(join(root, 'intent.lock'), '{"lockfileVersion":2}\n')

    expect(runCli(root, ['scan', '--frozen'])).toBe(6)
  })

  it('fails when a discovered source is unlisted', () => {
    const root = createProject()
    writeSkillPackage(root, 'unlisted')
    approveInitialLock(root)

    expect(runCli(root, ['scan', '--frozen'])).toBe(3)
  })

  it('fails when an allowlisted source is added', () => {
    const root = createProject()
    approveInitialLock(root)
    writeProject(root, ['foo', 'bar'])
    writeSkillPackage(root, 'bar')

    expect(runCli(root, ['scan', '--frozen'])).toBe(2)
  })

  it('fails when a locked source is removed', () => {
    const root = createProject()
    approveInitialLock(root)
    rmSync(join(root, 'node_modules', 'foo'), { recursive: true, force: true })

    expect(runCli(root, ['scan', '--frozen'])).toBe(2)
  })

  it('fails when a locked source content hash changes', () => {
    const root = createProject()
    approveInitialLock(root)
    writeFileSync(
      join(root, 'node_modules', 'foo', 'skills', 'core', 'SKILL.md'),
      '---\nname: core\ndescription: foo skill\n---\n\nChanged guidance.\n',
    )

    expect(runCli(root, ['scan', '--frozen'])).toBe(2)
  })

  it('fails when a locked source manifest metadata changes', () => {
    const root = createProject()
    writeManifest(root, 'foo')
    approveInitialLock(root)
    writeManifest(root, 'foo', ['uses_network'])

    expect(runCli(root, ['scan', '--frozen'])).toBe(2)
  })

  it('refuses to load changed approved content in frozen mode', () => {
    const root = createProject()
    approveInitialLock(root)
    writeFileSync(
      join(root, 'node_modules', 'foo', 'skills', 'core', 'SKILL.md'),
      '---\nname: core\ndescription: foo skill\n---\n\nChanged guidance.\n',
    )

    expect(runCommand(root, ['load', 'foo#core', '--frozen'])).toBe(1)
  })
})
