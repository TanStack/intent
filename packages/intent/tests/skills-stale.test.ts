import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCurrentLockfileSources } from '../src/core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { runSkillsStaleCommand } from '../src/commands/skills/stale.js'
import type {
  IntentLockfile,
  IntentLockfileSource,
} from '../src/core/lockfile/lockfile.js'
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

function baseLockfile(overrides: Partial<IntentLockfile> = {}): IntentLockfile {
  return {
    lockfileVersion: 1,
    intentVersion: '0.0.0',
    sources: [],
    policy: { ignores: [] },
    ...overrides,
  }
}

function source(
  overrides: Partial<IntentLockfileSource>,
): IntentLockfileSource {
  return {
    id: '@acme/pkg',
    kind: 'npm',
    version: '1.0.0',
    resolution: null,
    skills: ['skills/core/SKILL.md'],
    contentHash: 'sha256-x',
    manifestHash: null,
    capabilities: null,
    ...overrides,
  }
}

describe('runSkillsStaleCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tempDirs: Array<string> = []
  const externalDirs: Array<string> = []

  afterEach(() => {
    logSpy.mockClear()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    for (const dir of externalDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function git(cwd: string, args: Array<string>): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' })
  }

  function makeTempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'intent-skills-stale-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    git(dir, ['init', '--quiet'])
    git(dir, ['config', 'user.email', 'test@example.com'])
    git(dir, ['config', 'user.name', 'Test'])
    return dir
  }

  it('reports no lockfile when intent.lock is missing', async () => {
    const cwd = makeTempProject()

    await runSkillsStaleCommand({}, () => Promise.resolve(policedScan()), cwd)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain(
      'No intent.lock found. Run `intent skills approve --all` to create one.',
    )
  })

  it('throws in frozen mode when intent.lock is missing', async () => {
    const cwd = makeTempProject()

    await expect(
      runSkillsStaleCommand(
        { frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Frozen mode requires intent.lock'),
    })
  })

  it('throws in frozen mode when discovery finds an unlisted skill-bearing source', async () => {
    const cwd = makeTempProject()
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '--quiet', '-m', 'first'])
    git(cwd, ['tag', 'v1.0.0'])
    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsStaleCommand(
        { frozen: true },
        () => Promise.resolve(policedScan({ hiddenSourceCount: 1 })),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('unlisted skill-bearing source'),
      exitCode: 3,
    })
  })

  it('reports no candidates when nothing changed since baseline and lockfile is clean', async () => {
    const cwd = makeTempProject()
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '--quiet', '-m', 'first'])
    git(cwd, ['tag', 'v1.0.0'])

    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsStaleCommand({}, () => Promise.resolve(policedScan()), cwd)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('No staleness candidates found')
  })

  it('does not treat an approved installed dependency as baseline drift in frozen mode', async () => {
    const cwd = makeTempProject()
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '--quiet', '-m', 'first'])
    git(cwd, ['tag', 'v1.0.0'])
    const installedRoot = mkdtempSync(
      join(tmpdir(), 'installed-stale-package-'),
    )
    externalDirs.push(installedRoot)
    const skillPath = join(installedRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(installedRoot, 'skills', 'core'), { recursive: true })
    writeFileSync(skillPath, 'installed guidance')
    const pkg: IntentPackage = {
      name: '@acme/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: '', docs: '' },
      skills: [{ name: 'core', path: skillPath, description: '' }],
      packageRoot: installedRoot,
      kind: 'npm',
      source: 'local',
    }
    writeIntentLockfile(
      join(cwd, 'intent.lock'),
      baseLockfile({ sources: buildCurrentLockfileSources([pkg]) }),
    )

    await expect(
      runSkillsStaleCommand(
        { frozen: true },
        () => Promise.resolve(policedScan({ scan: emptyScanResult([pkg]) })),
        cwd,
      ),
    ).resolves.toBeUndefined()
  })

  it('reports layer 2 drift when a tracked skill file changed since the baseline tag', async () => {
    const cwd = makeTempProject()
    writeFileSync(join(cwd, 'skills-core-SKILL.md'), 'original')
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '--quiet', '-m', 'first'])
    git(cwd, ['tag', 'v1.0.0'])
    writeFileSync(join(cwd, 'skills-core-SKILL.md'), 'edited after baseline')

    writeIntentLockfile(
      join(cwd, 'intent.lock'),
      baseLockfile({
        sources: [
          source({
            id: '@acme/pkg',
            skills: ['skills-core-SKILL.md'],
            // Matches the on-disk content (via buildCurrentLockfileSources
            // in a real scan); irrelevant here since we bypass that path by
            // supplying an empty current scan — the diff engine reports it
            // as "removed", which is layer01, while Layer 2 checks the
            // git blob directly against the package root below.
          }),
        ],
      }),
    )

    const pkg: IntentPackage = {
      name: '@acme/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: '', docs: '' },
      skills: [],
      packageRoot: cwd,
      kind: 'npm',
      source: 'local',
    }

    await runSkillsStaleCommand(
      {},
      () => Promise.resolve(policedScan({ scan: emptyScanResult([pkg]) })),
      cwd,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('changed-since-baseline')
  })

  it('fails closed in frozen mode when no baseline can be resolved', async () => {
    const cwd = makeTempProject()
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '--quiet', '-m', 'first'])
    // no tag: nearestReachableTag will fail, and there is no lockfile baseline

    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await expect(
      runSkillsStaleCommand(
        { frozen: true },
        () => Promise.resolve(policedScan()),
        cwd,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('resolvable staleness baseline'),
    })
  })

  it('skips layer 2 (without failing) in interactive mode when no baseline resolves', async () => {
    const cwd = makeTempProject()
    git(cwd, ['add', '.'])
    git(cwd, ['commit', '--quiet', '-m', 'first'])

    writeIntentLockfile(join(cwd, 'intent.lock'), baseLockfile())

    await runSkillsStaleCommand({}, () => Promise.resolve(policedScan()), cwd)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Layer 2 (baseline drift) skipped')
  })
})
