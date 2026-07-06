import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readIntentLockfile,
  writeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'
import { runSkillsApproveCommand } from '../src/commands/skills/approve.js'
import type { IntentLockfile } from '../src/core/lockfile/lockfile.js'
import type { PolicedScan } from '../src/core/source-policy.js'
import type { IntentPackage, ScanResult } from '../src/shared/types.js'

function emptyScanResult(packages: Array<IntentPackage> = []): ScanResult {
  return {
    packageManager: 'npm',
    packages,
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

function policedScan(overrides: Partial<PolicedScan> = {}): PolicedScan {
  return {
    scan: emptyScanResult(),
    hiddenSourceCount: 0,
    hiddenSources: [],
    excludePatterns: [],
    droppedNames: [],
    ...overrides,
  }
}

function baseLockfile(): IntentLockfile {
  return {
    lockfileVersion: 1,
    intentVersion: '0.0.0',
    sources: [],
    policy: { ignores: [] },
  }
}

function lockedSource(
  overrides: Partial<IntentLockfile['sources'][number]> = {},
): IntentLockfile['sources'][number] {
  return {
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
    ...overrides,
  }
}

describe('runSkillsApproveCommand', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'intent-skills-approve-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    return dir
  }

  it('refuses to run in frozen mode', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsApproveCommand(
        undefined,
        { all: true, frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('cannot run in frozen mode'),
    })
  })

  it('rejects passing both a source id and --all', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsApproveCommand(
        'npm:foo',
        { all: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('either a source id or --all'),
    })
  })

  it('reports nothing to approve when current matches the lockfile', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsApproveCommand(
      undefined,
      {},
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Nothing to approve')
  })

  it('--all creates the initial lockfile on first run', async () => {
    const cwd = makeTempProject()

    await runSkillsApproveCommand(
      undefined,
      { all: true },
      () =>
        Promise.resolve(
          policedScan({
            scan: emptyScanResult([
              {
                name: 'foo',
                kind: 'npm',
                version: '1.0.0',
                packageRoot: cwd,
                skills: [],
              } as unknown as IntentPackage,
            ]),
          }),
        ),
      cwd,
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources).toHaveLength(1)
      expect(result.lockfile.sources[0]).toMatchObject({
        id: 'foo',
        kind: 'npm',
      })
    }
  })

  it('--all removes a locked source that is no longer discovered', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource()],
    })

    await runSkillsApproveCommand(
      undefined,
      { all: true },
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources).toHaveLength(0)
    }
  })

  it('approves a single source id without touching unrelated pending changes', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo' }), lockedSource({ id: 'bar' })],
    })

    await runSkillsApproveCommand(
      'npm:foo',
      {},
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      // "bar" still has a pending removal (declined) — stays in the lock as drift.
      expect(result.lockfile.sources.map((s) => s.id).sort()).toEqual(['bar'])
    }
  })

  it('fails when the given source id has no pending change', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsApproveCommand(
        'npm:does-not-exist',
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('No pending change for'),
    })
  })

  it('rejects an invalid source id format', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsApproveCommand(
        'not-a-valid-source',
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Invalid source'),
    })
  })

  it('interactive mode only writes changes the confirm callback approves', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo' }), lockedSource({ id: 'bar' })],
    })

    // Both "foo" and "bar" are pending removals (not currently discovered).
    // Approve removing "foo", decline removing "bar".
    await runSkillsApproveCommand(
      undefined,
      {},
      () => Promise.resolve(policedScan()),
      cwd,
      (question) => Promise.resolve(question.includes('foo')),
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources.map((s) => s.id)).toEqual(['bar'])
    }
  })

  it('reports hidden sources without blocking approval', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource()],
    })

    await runSkillsApproveCommand(
      undefined,
      { all: true },
      () => Promise.resolve(policedScan({ hiddenSourceCount: 2 })),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('2 discovered skill-bearing source(s)')
  })

  it('reports hidden sources even when there is nothing else to approve', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsApproveCommand(
      undefined,
      {},
      () => Promise.resolve(policedScan({ hiddenSourceCount: 3 })),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('3 discovered skill-bearing source(s)')
    expect(output).toContain('Nothing to approve')
  })

  it('approves a version/hash change (update) for a source that still exists', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo', version: '1.0.0' })],
    })

    await runSkillsApproveCommand(
      undefined,
      { all: true },
      () =>
        Promise.resolve(
          policedScan({
            scan: emptyScanResult([
              {
                name: 'foo',
                kind: 'npm',
                version: '2.0.0',
                packageRoot: cwd,
                skills: [],
              } as unknown as IntentPackage,
            ]),
          }),
        ),
      cwd,
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources).toHaveLength(1)
      expect(result.lockfile.sources[0]).toMatchObject({
        id: 'foo',
        version: '2.0.0',
      })
    }
  })

  it('preserves the existing policy.ignores through approve --all', async () => {
    const cwd = makeTempProject()
    const ignore = {
      id: 'ignored-thing',
      scope: { source: 'npm:foo', contentHash: 'sha256-aaa' },
      reason: 'reviewed and accepted',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    }
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource()],
      policy: { ignores: [ignore] },
    })

    await runSkillsApproveCommand(
      undefined,
      { all: true },
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.policy.ignores).toEqual([ignore])
    }
  })

  it('does not write intent.lock when every pending change is declined', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource()],
    })
    const before = readFileSync(join(cwd, 'intent.lock'), 'utf8')

    await runSkillsApproveCommand(
      undefined,
      {},
      () => Promise.resolve(policedScan()),
      cwd,
      () => Promise.resolve(false),
    )

    const after = readFileSync(join(cwd, 'intent.lock'), 'utf8')
    expect(after).toBe(before)
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('No changes approved')
  })

  it('fails instead of prompting when stdin is not a TTY and no --all/source id is given', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource()],
    })

    await expect(
      runSkillsApproveCommand(
        undefined,
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('stdin is not a TTY'),
    })
  })
})
