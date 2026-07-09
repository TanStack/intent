import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeBaselineDrift,
  resolveBaseline,
} from '../src/core/lockfile/baseline-drift.js'
import type {
  IntentLockfile,
  IntentLockfileSource,
} from '../src/core/lockfile/lockfile.js'

let repoDir: string

function git(args: Array<string>): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' })
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

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'baseline-drift-test-'))
  git(['init', '--quiet'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

describe('resolveBaseline', () => {
  it('prefers the explicit ref over the lockfile baseline', () => {
    mkdirSync(join(repoDir, 'pkg'), { recursive: true })
    writeFileSync(join(repoDir, 'pkg', 'a.txt'), 'one')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])
    writeFileSync(join(repoDir, 'pkg', 'a.txt'), 'two')
    git(['commit', '--quiet', '-am', 'second'])
    git(['tag', 'v2.0.0'])

    const lockfile = baseLockfile({
      staleness: {
        baseline: { kind: 'tag', ref: 'v2.0.0', commit: 'ignored' },
      },
    })

    const result = resolveBaseline(repoDir, 'v1.0.0', lockfile)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.baseline.ref).toBe('v1.0.0')
    }
  })

  it('falls back to the lockfile-recorded baseline when no explicit ref is given', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'one')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])

    const lockfile = baseLockfile({
      staleness: {
        baseline: { kind: 'tag', ref: 'v1.0.0', commit: 'ignored' },
      },
    })

    const result = resolveBaseline(repoDir, undefined, lockfile)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.baseline.ref).toBe('v1.0.0')
    }
  })

  it('falls back to the nearest reachable tag with no explicit ref or lockfile baseline', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'one')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v3.0.0'])

    const result = resolveBaseline(repoDir, undefined, baseLockfile())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.baseline.ref).toBe('v3.0.0')
    }
  })

  it('fails when nothing resolves', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'one')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])

    const result = resolveBaseline(repoDir, undefined, baseLockfile())
    expect(result.ok).toBe(false)
  })
})

describe('computeBaselineDrift', () => {
  it('reports no candidates when nothing changed since baseline', () => {
    mkdirSync(join(repoDir, 'pkg', 'skills', 'core'), { recursive: true })
    writeFileSync(join(repoDir, 'pkg', 'skills', 'core', 'SKILL.md'), 'content')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])

    const baseline = resolveBaseline(repoDir, 'v1.0.0', baseLockfile())
    expect(baseline.ok).toBe(true)
    if (!baseline.ok) return

    const sources = [source({ skills: ['skills/core/SKILL.md'] })]
    const packageRoots = new Map([['npm:@acme/pkg', join(repoDir, 'pkg')]])

    const result = computeBaselineDrift(
      repoDir,
      baseline.baseline,
      sources,
      packageRoots,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.candidates).toEqual([])
    }
  })

  it('reports a changed-since-baseline candidate when the file was edited', () => {
    mkdirSync(join(repoDir, 'pkg', 'skills', 'core'), { recursive: true })
    writeFileSync(
      join(repoDir, 'pkg', 'skills', 'core', 'SKILL.md'),
      'original',
    )
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])

    writeFileSync(
      join(repoDir, 'pkg', 'skills', 'core', 'SKILL.md'),
      'edited after baseline',
    )

    const baseline = resolveBaseline(repoDir, 'v1.0.0', baseLockfile())
    expect(baseline.ok).toBe(true)
    if (!baseline.ok) return

    const sources = [source({ skills: ['skills/core/SKILL.md'] })]
    const packageRoots = new Map([['npm:@acme/pkg', join(repoDir, 'pkg')]])

    const result = computeBaselineDrift(
      repoDir,
      baseline.baseline,
      sources,
      packageRoots,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.candidates).toEqual([
        {
          id: '@acme/pkg',
          kind: 'npm',
          path: 'skills/core/SKILL.md',
          reason: 'changed-since-baseline',
        },
      ])
    }
  })

  it('reports an added-since-baseline candidate for a new skill file', () => {
    mkdirSync(join(repoDir, 'pkg', 'skills', 'core'), { recursive: true })
    writeFileSync(
      join(repoDir, 'pkg', 'skills', 'core', 'SKILL.md'),
      'original',
    )
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])

    mkdirSync(join(repoDir, 'pkg', 'skills', 'new'), { recursive: true })
    writeFileSync(join(repoDir, 'pkg', 'skills', 'new', 'SKILL.md'), 'new one')

    const baseline = resolveBaseline(repoDir, 'v1.0.0', baseLockfile())
    expect(baseline.ok).toBe(true)
    if (!baseline.ok) return

    const sources = [
      source({
        skills: ['skills/core/SKILL.md', 'skills/new/SKILL.md'],
      }),
    ]
    const packageRoots = new Map([['npm:@acme/pkg', join(repoDir, 'pkg')]])

    const result = computeBaselineDrift(
      repoDir,
      baseline.baseline,
      sources,
      packageRoots,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.candidates).toEqual([
        {
          id: '@acme/pkg',
          kind: 'npm',
          path: 'skills/new/SKILL.md',
          reason: 'added-since-baseline',
        },
      ])
    }
  })

  it('respects the file filter, skipping paths not in the set', () => {
    mkdirSync(join(repoDir, 'pkg', 'skills', 'core'), { recursive: true })
    writeFileSync(
      join(repoDir, 'pkg', 'skills', 'core', 'SKILL.md'),
      'original',
    )
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])

    writeFileSync(
      join(repoDir, 'pkg', 'skills', 'core', 'SKILL.md'),
      'edited after baseline',
    )

    const baseline = resolveBaseline(repoDir, 'v1.0.0', baseLockfile())
    expect(baseline.ok).toBe(true)
    if (!baseline.ok) return

    const sources = [source({ skills: ['skills/core/SKILL.md'] })]
    const packageRoots = new Map([['npm:@acme/pkg', join(repoDir, 'pkg')]])
    const fileFilter = new Set(['some/other/path.md'])

    const result = computeBaselineDrift(
      repoDir,
      baseline.baseline,
      sources,
      packageRoots,
      fileFilter,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.candidates).toEqual([])
    }
  })
})
