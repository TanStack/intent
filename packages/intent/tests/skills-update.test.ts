import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readIntentLockfile,
  writeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'
import { runSkillsUpdateCommand } from '../src/commands/skills/update.js'
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
    skills: [],
    manifestHash: null,
    contentHash: 'sha256-aaa',
    capabilities: null,
    ...overrides,
  }
}

describe('runSkillsUpdateCommand', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'intent-skills-update-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    return dir
  }

  it('refuses to run in frozen mode', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsUpdateCommand(
        undefined,
        { frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('cannot run in frozen mode'),
      exitCode: 5,
    })
  })

  it('rejects passing both a source id and --all', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsUpdateCommand(
        'npm:foo',
        { all: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('either a source id or --all'),
    })
  })

  it('fails when there is no intent.lock', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsUpdateCommand(
        undefined,
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('No intent.lock found'),
    })
  })

  it('reports nothing to update when current matches the lockfile', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsUpdateCommand(
      undefined,
      {},
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Nothing to update')
  })

  it('re-syncs a version/hash change for all locked sources', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo', version: '1.0.0' })],
    })

    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy

    await runSkillsUpdateCommand(
      undefined,
      { yes: true },
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

    expect(fetchSpy).not.toHaveBeenCalled()

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources).toHaveLength(1)
      expect(result.lockfile.sources[0]).toMatchObject({
        id: 'foo',
        version: '2.0.0',
      })
    }

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Updated 1 source(s)')
  })

  it('requires --yes before accepting a content hash change', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource()],
    })

    await expect(
      runSkillsUpdateCommand(
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
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('--yes'),
    })

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources[0]?.contentHash).toBe('sha256-aaa')
    }

    await runSkillsUpdateCommand(
      undefined,
      { all: true, yes: true },
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

    const updated = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(updated.status).toBe('found')
    if (updated.status === 'found') {
      expect(updated.lockfile.sources[0]?.contentHash).not.toBe('sha256-aaa')
    }
  })

  it('preserves metadata while updating a targeted source', async () => {
    const cwd = makeTempProject()
    const metadata = {
      staleness: {
        baseline: { kind: 'tag' as const, ref: 'v1.0.0', commit: 'abc123' },
      },
      policy: {
        ignores: [
          {
            id: 'rejected-thing',
            scope: { source: 'npm:foo', contentHash: 'sha256-aaa' },
            reason: 'reviewed and rejected',
            createdAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
          },
        ],
      },
    }
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      ...metadata,
      sources: [
        lockedSource({ id: 'foo', version: '1.0.0' }),
        lockedSource({ id: 'bar', version: '1.0.0' }),
      ],
    })

    await runSkillsUpdateCommand(
      'npm:foo',
      { yes: true },
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
              {
                name: 'bar',
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
      const foo = result.lockfile.sources.find((s) => s.id === 'foo')
      const bar = result.lockfile.sources.find((s) => s.id === 'bar')
      expect(foo?.version).toBe('2.0.0')
      expect(bar?.version).toBe('1.0.0')
      expect({
        staleness: result.lockfile.staleness,
        policy: result.lockfile.policy,
      }).toEqual(metadata)
    }
  })

  it('does not add newly discovered sources that are not yet locked', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsUpdateCommand(
      undefined,
      { all: true, yes: true },
      () =>
        Promise.resolve(
          policedScan({
            scan: emptyScanResult([
              {
                name: 'new-source',
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
      expect(result.lockfile.sources).toHaveLength(0)
    }
  })

  it('reports pending added/removed drift after updating, since update never touches it', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [
        lockedSource({ id: 'foo', version: '1.0.0' }),
        lockedSource({ id: 'gone' }),
      ],
    })

    await runSkillsUpdateCommand(
      undefined,
      { all: true, yes: true },
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
              {
                name: 'new-source',
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

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Updated 1 source(s)')
    expect(output).toContain('1 added, 1 removed source(s) still pending')
    expect(output).toContain('intent skills approve')
  })

  it('does not remove a locked source that is no longer discovered', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo' })],
    })

    await runSkillsUpdateCommand(
      undefined,
      { all: true },
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const result = readIntentLockfile(join(cwd, 'intent.lock'))
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.lockfile.sources).toHaveLength(1)
      expect(result.lockfile.sources[0]).toMatchObject({ id: 'foo' })
    }

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Nothing to update')
  })

  it('fails when the given source id is not locked', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsUpdateCommand(
        'npm:does-not-exist',
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('is not in intent.lock'),
    })
  })

  it('fails when the given source id is locked but no longer discovered', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo' })],
    })

    await expect(
      runSkillsUpdateCommand(
        'npm:foo',
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('no longer discovered'),
    })
  })

  it('rejects an invalid source id format', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsUpdateCommand(
        'git:not-a-supported-kind',
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Invalid source'),
    })
  })

  it('fails when a bare name matches no discovered source', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo' })],
    })

    await expect(
      runSkillsUpdateCommand(
        'not-discovered',
        {},
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('No discovered source matches'),
    })
  })

  it('resolves a bare name to its single discovered match', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [lockedSource({ id: 'foo', version: '1.0.0' })],
    })

    await runSkillsUpdateCommand(
      'foo',
      { yes: true },
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
      expect(result.lockfile.sources[0]).toMatchObject({
        id: 'foo',
        version: '2.0.0',
      })
    }
  })

  it('errors on an ambiguous bare name matching sources of two kinds', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      sources: [
        lockedSource({ id: 'foo', kind: 'npm' }),
        lockedSource({ id: 'foo', kind: 'workspace' }),
      ],
    })

    await expect(
      runSkillsUpdateCommand(
        'foo',
        {},
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
                {
                  name: 'foo',
                  kind: 'workspace',
                  version: '1.0.0',
                  packageRoot: cwd,
                  skills: [],
                } as unknown as IntentPackage,
              ]),
            }),
          ),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Ambiguous source "foo"'),
    })
  })

  it('preserves the existing policy.ignores', async () => {
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
      sources: [lockedSource({ id: 'foo', version: '1.0.0' })],
      policy: { ignores: [ignore] },
    })

    await runSkillsUpdateCommand(
      undefined,
      { yes: true },
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
      expect(result.lockfile.policy.ignores).toEqual([ignore])
    }
  })

  it('preserves metadata through update --all', async () => {
    const cwd = makeTempProject()
    const metadata = {
      staleness: {
        baseline: { kind: 'tag' as const, ref: 'v1.0.0', commit: 'abc123' },
      },
      policy: {
        ignores: [
          {
            id: 'rejected-thing',
            scope: { source: 'npm:foo', contentHash: 'sha256-aaa' },
            reason: 'reviewed and rejected',
            createdAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
          },
        ],
      },
    }
    writeIntentLockfile(join(cwd, 'intent.lock'), {
      ...baseLockfile(),
      ...metadata,
      sources: [lockedSource({ id: 'foo', version: '1.0.0' })],
    })

    await runSkillsUpdateCommand(
      undefined,
      { yes: true },
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
      expect({
        staleness: result.lockfile.staleness,
        policy: result.lockfile.policy,
      }).toEqual(metadata)
    }
  })

  it('does not write intent.lock when nothing changed', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())
    const before = readFileSync(join(cwd, 'intent.lock'), 'utf8')

    await runSkillsUpdateCommand(
      undefined,
      {},
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const after = readFileSync(join(cwd, 'intent.lock'), 'utf8')
    expect(after).toBe(before)
  })
})
