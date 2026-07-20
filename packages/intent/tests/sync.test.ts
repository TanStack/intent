import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { updateIntentGitignore } from '../src/commands/sync/gitignore.js'
import { reconcileManagedLinks } from '../src/commands/sync/links.js'
import {
  parseInstallState,
  readInstallState,
  serializeInstallState,
  writeInstallState,
} from '../src/commands/sync/state.js'
import {
  createSyncAliases,
  resolveSyncTargetDirectories,
} from '../src/commands/sync/targets.js'

const tempDirs: Array<string> = []

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  tempDirs.push(root)
  return root
}

afterEach(() => {
  for (const root of tempDirs.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('sync targets and aliases', () => {
  it('deduplicates github and vscode target directories deterministically', () => {
    expect(
      resolveSyncTargetDirectories('/project', ['vscode', 'github', 'agents']),
    ).toEqual([
      { id: 'agents', path: join('/project', '.agents/skills') },
      { id: 'vscode', path: join('/project', '.github/skills') },
    ])
  })

  it('normalizes aliases and hashes every collision', () => {
    const aliases = createSyncAliases([
      { kind: 'npm', id: '@scope/a.b', skill: 'one/two' },
      { kind: 'npm', id: 'scope/a-b', skill: 'one/two' },
      { kind: 'workspace', id: '@scope/pkg', skill: 'core' },
    ])
    expect(aliases.map((entry) => entry.alias)).toEqual([
      expect.stringMatching(/^npm-scope-a-b-one-two-[a-f0-9]{8}$/),
      expect.stringMatching(/^npm-scope-a-b-one-two-[a-f0-9]{8}$/),
      'workspace-scope-pkg-core',
    ])
    expect(aliases[0]!.alias).not.toBe(aliases[1]!.alias)
  })
})

describe('sync state', () => {
  const state = {
    version: 1 as const,
    entries: [
      {
        targetDirectory: '.github/skills',
        path: '.github/skills/b',
        alias: 'b',
        source: { kind: 'npm' as const, id: 'pkg' },
        skillPath: 'skills/b',
        linkTarget: '/source/b',
      },
      {
        targetDirectory: '.github/skills',
        path: '.github/skills/a',
        alias: 'a',
        source: { kind: 'npm' as const, id: 'pkg' },
        skillPath: 'skills/a',
        linkTarget: '/source/a',
      },
    ],
  }

  it('strictly parses and deterministically serializes entries', () => {
    const serialized = serializeInstallState(state)
    expect(serialized.indexOf('"path": ".github/skills/a"')).toBeLessThan(
      serialized.indexOf('"path": ".github/skills/b"'),
    )
    expect(
      parseInstallState(serialized)?.entries.map((entry) => entry.alias),
    ).toEqual(['a', 'b'])
    expect(
      parseInstallState('{"version":1,"entries":[],"extra":true}'),
    ).toBeNull()
  })

  it('writes atomically only when state changes and reports malformed state', () => {
    const root = tempRoot('intent-sync-state-')
    expect(writeInstallState(root, state)).toBe(true)
    expect(writeInstallState(root, state)).toBe(false)
    expect(readInstallState(root)).toMatchObject({ status: 'found' })
    writeFileSync(join(root, '.intent', 'install-state.json'), '{bad', 'utf8')
    expect(readInstallState(root)).toEqual({ status: 'malformed' })
  })
})

describe('managed sync links', () => {
  function expected(root: string) {
    const packageRoot = join(root, 'node_modules', 'pkg')
    const source = join(packageRoot, 'skills', 'core')
    const path = join(root, '.github', 'skills', 'npm-pkg-core')
    mkdirSync(source, { recursive: true })
    return {
      path,
      targetDirectory: '.github/skills',
      alias: 'npm-pkg-core',
      source: { kind: 'npm' as const, id: 'pkg' },
      skillPath: 'skills/core',
      sourceDirectory: source,
      packageRoot,
    }
  }

  it('creates, leaves unchanged, repairs owned links, and cleans owned stale links', () => {
    const root = tempRoot('intent-sync-links-')
    const link = expected(root)
    const first = reconcileManagedLinks({
      dryRun: false,
      expected: [link],
      stateResult: { status: 'missing' },
    })
    expect(first.created).toEqual([link.path])
    expect(lstatSync(link.path).isSymbolicLink()).toBe(true)
    const second = reconcileManagedLinks({
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: { version: 1, entries: first.entries },
      },
    })
    expect(second.unchanged).toEqual([link.path])
    rmSync(link.path, { recursive: true, force: true })
    const repaired = reconcileManagedLinks({
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: { version: 1, entries: first.entries },
      },
    })
    expect(repaired.created).toEqual([link.path])
    const cleanup = reconcileManagedLinks({
      dryRun: false,
      expected: [],
      stateResult: {
        status: 'found',
        state: { version: 1, entries: repaired.entries },
      },
    })
    expect(cleanup.removed).toEqual([link.path])
    expect(existsSync(link.path)).toBe(false)
  })

  it('does not replace unmanaged links and makes dry runs non-writing', () => {
    const root = tempRoot('intent-sync-conflict-')
    const link = expected(root)
    mkdirSync(join(root, '.github', 'skills'), { recursive: true })
    symlinkSync(join(root, 'somewhere-else'), link.path, 'dir')
    const conflict = reconcileManagedLinks({
      dryRun: false,
      expected: [link],
      stateResult: { status: 'missing' },
    })
    expect(conflict.conflicts).toEqual([link.path])
    const dryRunLink = {
      ...link,
      path: join(root, '.github', 'skills', 'dry-run'),
    }
    const dryRun = reconcileManagedLinks({
      dryRun: true,
      expected: [dryRunLink],
      stateResult: { status: 'missing' },
    })
    expect(dryRun.created).toEqual([dryRunLink.path])
    expect(existsSync(dryRunLink.path)).toBe(false)
  })

  it('treats an unreadable owned link target as a conflict', () => {
    const root = tempRoot('intent-sync-unreadable-')
    const link = expected(root)
    mkdirSync(join(root, '.github', 'skills'), { recursive: true })
    symlinkSync(join(root, 'missing'), link.path, 'dir')

    const result = reconcileManagedLinks({
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: {
          version: 1,
          entries: [
            {
              targetDirectory: link.targetDirectory,
              path: link.path,
              alias: link.alias,
              source: link.source,
              skillPath: link.skillPath,
              linkTarget: link.sourceDirectory,
            },
          ],
        },
      },
    })

    expect(result.conflicts).toEqual([link.path])
    expect(result.repaired).toEqual([])
  })
})

describe('sync managed text', () => {
  it('updates only the exact gitignore block while preserving CRLF', () => {
    const updated = updateIntentGitignore('node_modules/\r\n', [
      '.github/skills/a',
      '.intent/install-state.json',
    ])
    expect(updated).toContain('node_modules/\r\n# intent skill links:start\r\n')
    expect(updated).toContain('.github/skills/a\r\n')
    expect(
      updateIntentGitignore(updated, [
        '.github/skills/a',
        '.intent/install-state.json',
      ]),
    ).toBe(updated)
  })
})
