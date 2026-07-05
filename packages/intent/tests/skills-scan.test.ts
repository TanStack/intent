import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { runSkillsScanCommand } from '../src/commands/skills/scan.js'
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

describe('runSkillsScanCommand', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'intent-skills-scan-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    return dir
  }

  it('reports no lockfile when intent.lock is missing', async () => {
    const cwd = makeTempProject()

    await runSkillsScanCommand(
      {},
      () => Promise.resolve(emptyScanResult()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('No intent.lock found')
  })

  it('reports up to date when current sources match the lockfile', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsScanCommand(
      {},
      () => Promise.resolve(emptyScanResult()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('intent.lock is up to date')
  })

  it('reports drift when the lockfile has a source no longer present', async () => {
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

    await runSkillsScanCommand(
      {},
      () => Promise.resolve(emptyScanResult()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('out of date')
    expect(output).toContain('1 removed')
  })

  it('outputs JSON with a frozen field when --json is passed', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsScanCommand(
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
      runSkillsScanCommand(
        { frozen: true },
        () => Promise.resolve(emptyScanResult()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Frozen mode requires intent.lock'),
    })
  })

  it('throws in frozen mode when intent.lock is stale', async () => {
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

    await expect(
      runSkillsScanCommand(
        { frozen: true },
        () => Promise.resolve(emptyScanResult()),
        cwd,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('out of date') })
  })

  it('does not throw in frozen mode when intent.lock is clean', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsScanCommand(
        { frozen: true },
        () => Promise.resolve(emptyScanResult()),
        cwd,
      ),
    ).resolves.toBeUndefined()
  })
})
