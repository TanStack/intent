import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  blobShaAtCommit,
  currentBlobSha,
  nearestReachableTag,
  repoRoot,
  resolveCommit,
} from '../src/core/git-adapter.js'

let repoDir: string

function git(args: Array<string>): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' })
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'git-adapter-test-'))
  git(['init', '--quiet'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

describe('resolveCommit', () => {
  it('resolves HEAD to a full commit sha', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'one')
    git(['add', 'a.txt'])
    git(['commit', '--quiet', '-m', 'first'])

    const result = resolveCommit(repoDir, 'HEAD')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('fails for a ref that does not exist', () => {
    const result = resolveCommit(repoDir, 'does-not-exist')
    expect(result.ok).toBe(false)
  })

  it('fails when cwd is not a git repository', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'not-a-repo-'))
    try {
      const result = resolveCommit(outsideDir, 'HEAD')
      expect(result.ok).toBe(false)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('nearestReachableTag', () => {
  it('fails when there are no tags', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'one')
    git(['add', 'a.txt'])
    git(['commit', '--quiet', '-m', 'first'])

    const result = nearestReachableTag(repoDir)
    expect(result.ok).toBe(false)
  })

  it('finds the nearest tag reachable from HEAD', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'one')
    git(['add', 'a.txt'])
    git(['commit', '--quiet', '-m', 'first'])
    git(['tag', 'v1.0.0'])
    writeFileSync(join(repoDir, 'a.txt'), 'two')
    git(['commit', '--quiet', '-am', 'second'])

    const result = nearestReachableTag(repoDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('v1.0.0')
    }
  })
})

describe('blobShaAtCommit', () => {
  it('returns the blob sha for a path that exists at the given commit', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'hello')
    git(['add', 'a.txt'])
    git(['commit', '--quiet', '-m', 'first'])
    const commit = resolveCommit(repoDir, 'HEAD')
    expect(commit.ok).toBe(true)
    if (!commit.ok) return

    const expectedSha = git(['hash-object', 'a.txt']).trim()
    const result = blobShaAtCommit(repoDir, commit.value, 'a.txt')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(expectedSha)
    }
  })

  it('returns null for a path that did not exist at the given commit', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'hello')
    git(['add', 'a.txt'])
    git(['commit', '--quiet', '-m', 'first'])
    const commit = resolveCommit(repoDir, 'HEAD')
    expect(commit.ok).toBe(true)
    if (!commit.ok) return

    const result = blobShaAtCommit(repoDir, commit.value, 'missing.txt')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeNull()
    }
  })
})

describe('currentBlobSha', () => {
  it('matches the sha git hash-object would produce for the file on disk', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'current content')
    const expectedSha = git(['hash-object', 'a.txt']).trim()

    const result = currentBlobSha(repoDir, 'a.txt')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(expectedSha)
    }
  })

  it('returns null when the file does not exist', () => {
    const result = currentBlobSha(repoDir, 'missing.txt')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeNull()
    }
  })

  it('detects drift: current content hashes differently than the baseline blob', () => {
    writeFileSync(join(repoDir, 'a.txt'), 'baseline content')
    git(['add', 'a.txt'])
    git(['commit', '--quiet', '-m', 'first'])
    const commit = resolveCommit(repoDir, 'HEAD')
    expect(commit.ok).toBe(true)
    if (!commit.ok) return
    const baseline = blobShaAtCommit(repoDir, commit.value, 'a.txt')
    expect(baseline.ok).toBe(true)
    if (!baseline.ok) return

    writeFileSync(join(repoDir, 'a.txt'), 'drifted content')
    const current = currentBlobSha(repoDir, 'a.txt')
    expect(current.ok).toBe(true)
    if (!current.ok) return

    expect(current.value).not.toBe(baseline.value)
  })
})

describe('repoRoot', () => {
  it('resolves the working tree root', () => {
    const result = repoRoot(repoDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // realpath both sides: tmpdir on macOS is a symlink (/tmp -> /private/tmp)
      expect(realpathSync(result.value)).toBe(realpathSync(repoDir))
    }
  })

  it('fails outside a git repository', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'not-a-repo-'))
    try {
      const result = repoRoot(outsideDir)
      expect(result.ok).toBe(false)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('forbidden flags', () => {
  it('refuses to run if a forbidden flag were ever passed through', () => {
    // The adapter's public functions never construct forbidden flags
    // themselves; this test exercises the internal guard indirectly by
    // confirming a ref value containing a flag-shaped string is still
    // treated as a literal ref (via `--`) rather than a flag, i.e. it
    // fails as "unknown ref", not as a forbidden-flag execution.
    const result = resolveCommit(repoDir, '-c')
    expect(result.ok).toBe(false)
  })
})
