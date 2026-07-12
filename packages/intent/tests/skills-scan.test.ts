import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { runSkillsScanCommand } from '../src/commands/skills/scan.js'
import type { IntentLockfile } from '../src/core/lockfile/lockfile.js'
import type { PolicedScan } from '../src/core/source-policy.js'
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

    await runSkillsScanCommand({}, () => Promise.resolve(policedScan()), cwd)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('No intent.lock found')
  })

  it('reports up to date when current sources match the lockfile', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsScanCommand({}, () => Promise.resolve(policedScan()), cwd)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('intent.lock is up to date')
  })

  it('reports hidden (unlisted) sources even when the lockfile is clean', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsScanCommand(
      {},
      () =>
        Promise.resolve(
          policedScan({
            hiddenSourceCount: 2,
            hiddenSources: [
              {
                kind: 'workspace',
                name: 'leaf',
                skillCount: 1,
                provenance: [['app', 'parent', 'leaf']],
              },
              { kind: 'npm', name: 'unknown', skillCount: 1 },
            ],
          }),
        ),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('2 discovered skill-bearing source(s)')
    expect(output).toContain('workspace:leaf (via app -> parent -> leaf)')
    expect(output).toContain('npm:unknown (provenance unknown)')
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
          skills: [],
          manifestHash: null,
          contentHash: 'sha256-aaa',
          capabilities: null,
        },
      ],
    })

    await runSkillsScanCommand({}, () => Promise.resolve(policedScan()), cwd)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('out of date')
    expect(output).toContain('1 removed')
  })

  it('outputs JSON with frozen and hiddenSourceCount fields when --json is passed', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsScanCommand(
      { json: true },
      () => Promise.resolve(policedScan()),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    const parsed = JSON.parse(output)
    expect(parsed).toMatchObject({
      frozen: false,
      hiddenSourceCount: 0,
      isClean: true,
    })
  })

  it('throws in frozen mode when intent.lock is missing', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsScanCommand(
        { frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Frozen mode requires intent.lock'),
      exitCode: 4,
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
          skills: [],
          manifestHash: null,
          contentHash: 'sha256-aaa',
          capabilities: null,
        },
      ],
    })

    await expect(
      runSkillsScanCommand(
        { frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('out of date'),
      exitCode: 2,
    })
  })

  it('throws in frozen mode when there are unlisted skill-bearing sources, even with a clean lockfile', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsScanCommand(
        { frozen: true },
        () =>
          Promise.resolve(
            policedScan({
              hiddenSourceCount: 1,
              hiddenSources: [
                {
                  kind: 'workspace',
                  name: 'leaf',
                  skillCount: 1,
                  provenance: [['app', 'parent', 'leaf']],
                },
              ],
            }),
          ),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /unlisted skill-bearing source.*workspace:leaf \(via app -> parent -> leaf\)/,
      ),
      exitCode: 3,
    })
  })

  it('does not throw in frozen mode when intent.lock is clean and there are no hidden sources', async () => {
    const cwd = makeTempProject()
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsScanCommand(
        { frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).resolves.toBeUndefined()
  })

  it('fails with exit code 6 when intent.lock is malformed', async () => {
    const cwd = makeTempProject()
    writeFileSync(
      join(cwd, 'intent.lock'),
      JSON.stringify({ lockfileVersion: 2 }),
    )

    await expect(
      runSkillsScanCommand({}, () => Promise.resolve(policedScan()), cwd),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Malformed intent.lock'),
      exitCode: 6,
    })
  })
})
