import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectChangedPathsSince } from '../src/staleness/git-changes.js'

const tempDirectories: Array<string> = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'intent-git-changes-'))
  tempDirectories.push(directory)
  return directory
}

function git(repositoryRoot: string, ...args: Array<string>): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
}

function write(repositoryRoot: string, path: string, content: string): void {
  const file = join(repositoryRoot, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function commit(repositoryRoot: string, message: string): void {
  git(repositoryRoot, 'add', '--all')
  git(
    repositoryRoot,
    '-c',
    'user.name=Intent Tests',
    '-c',
    'user.email=intent@example.invalid',
    'commit',
    '--quiet',
    '-m',
    message,
  )
}

function createRepository(): { root: string; baseline: string } {
  const root = createDirectory()
  git(root, 'init', '--quiet')
  write(root, 'src/changed.ts', 'before\n')
  write(root, 'src/deleted.ts', 'deleted\n')
  write(root, 'src/renamed.ts', 'rename content\n')
  commit(root, 'baseline')
  return { root, baseline: git(root, 'rev-parse', 'HEAD') }
}

describe('collectChangedPathsSince', () => {
  it('returns added, modified, and deleted paths without reading their files', () => {
    const { root, baseline } = createRepository()
    write(root, 'src/changed.ts', 'after\n')
    write(root, 'src/added.ts', 'added\n')
    git(root, 'rm', '--quiet', 'src/deleted.ts')
    commit(root, 'change files')

    expect(collectChangedPathsSince(root, baseline)).toEqual([
      'src/added.ts',
      'src/changed.ts',
      'src/deleted.ts',
    ])
  })

  it('returns both sides of a rename', () => {
    const { root, baseline } = createRepository()
    git(root, 'mv', 'src/renamed.ts', 'src/moved.ts')
    commit(root, 'rename file')

    expect(collectChangedPathsSince(root, baseline)).toEqual([
      'src/moved.ts',
      'src/renamed.ts',
    ])
  })

  it('returns no paths when the baseline is HEAD', () => {
    const { root } = createRepository()

    expect(collectChangedPathsSince(root, 'HEAD')).toEqual([])
  })

  it('reports an unavailable baseline with shallow-clone remediation', () => {
    const { root } = createRepository()

    expect(() => collectChangedPathsSince(root, 'missing-ref')).toThrow(
      'Fetch that ref or deepen the clone, then retry.',
    )
  })

  it('reports a non-Git directory', () => {
    const root = createDirectory()

    expect(() => collectChangedPathsSince(root, 'HEAD')).toThrow(
      'is not a Git repository',
    )
  })

  it('rejects an empty baseline before invoking Git', () => {
    expect(() => collectChangedPathsSince(createDirectory(), '  ')).toThrow(
      'A non-empty Git baseline ref is required.',
    )
  })
})
