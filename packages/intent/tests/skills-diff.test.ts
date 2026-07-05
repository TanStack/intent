import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { runSkillsDiffCommand } from '../src/commands/skills/diff.js'
import type { IntentLockfile } from '../src/core/lockfile/lockfile.js'
import type { ScanResult } from '../src/shared/types.js'

function emptyScanResult(): ScanResult {
  return {
    packageManager: 'npm',
    packages: [],
    warnings: [],
    notices: [],
    conflicts: [],
    nodeModules: {
      local: { root: null, packages: [] },
      global: { root: null, packages: [] },
    },
    stats: {
      packageJsonReadCount: 0,
      packageJsonCacheHits: 0,
    },
  } as unknown as ScanResult
}

function baseLockfile(): IntentLockfile {
  return {
    lockfileVersion: 1,
    intentVersion: '0.0.0',
    sources: [],
    policy: { ignores: [] },
  }
}

describe('runSkillsDiffCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tempDirs: Array<string> = []

  afterEach(() => {
    logSpy.mockClear()
    vi.unstubAllEnvs()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeTempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'intent-skills-diff-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    return dir
  }

  it('lists removed sources when the lockfile has an entry no longer present', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [
        {
          id: 'foo',
          kind: 'npm',
          version: '1.0.0',
          resolution: 'npm:foo@1.0.0',
          manifestHash: null,
          contentHash: 'sha256-aaa',
          capabilities: [],
          declaredSecrets: [],
          mcpTools: [],
          mcpPolicy: {},
        },
      ],
    })

    await runSkillsDiffCommand(
      {},
      () => Promise.resolve(emptyScanResult()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Removed:')
    expect(output).toContain('npm:foo@1.0.0')
  })

  it('reports up to date when nothing has changed', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsDiffCommand(
      {},
      () => Promise.resolve(emptyScanResult()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('intent.lock is up to date')
  })

  it('outputs JSON with a frozen field when --json is passed', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsDiffCommand(
      { json: true },
      () => Promise.resolve(emptyScanResult()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    const parsed = JSON.parse(output)
    expect(parsed).toMatchObject({ frozen: false, isClean: true })
  })

  it('throws in frozen mode when intent.lock is missing', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsDiffCommand(
        { frozen: true },
        () => Promise.resolve(emptyScanResult()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Frozen mode requires intent.lock'),
    })
  })

  it('does not throw in frozen mode when intent.lock is clean', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsDiffCommand(
        { frozen: true },
        () => Promise.resolve(emptyScanResult()),
        cwd,
      ),
    ).resolves.toBeUndefined()
  })
})
