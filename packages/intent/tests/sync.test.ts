import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { updateIntentGitignore } from '../src/commands/sync/gitignore.js'
import { reconcileManagedLinks } from '../src/commands/sync/links.js'
import { wireIntentSyncPrepare } from '../src/commands/sync/prepare.js'
import {
  parseInstallState,
  readInstallState,
  readInstallStateForLinks,
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

function createDirectoryLink(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
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

  it.each([
    '',
    '/absolute/link',
    'outside\\link',
    'C:/link',
    'C:link',
    './link',
    'links/./link',
    'links//link',
    '../outside/link',
    'links/../outside',
    '.. /link',
    'links/.. /outside',
    'links/link.',
    'links/link ',
  ])('rejects invalid persisted path %j', (path) => {
    expect(
      parseInstallState(
        JSON.stringify({
          ...state,
          entries: [{ ...state.entries[0], path }],
        }),
      ),
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

  function ownedEntry(
    link: ReturnType<typeof expected>,
    linkTarget = link.sourceDirectory,
  ) {
    const { targetDirectory, path, alias, source, skillPath } = link
    return { targetDirectory, path, alias, source, skillPath, linkTarget }
  }

  it('rejects outside-parent create, repair, and stale removal', () => {
    const parent = tempRoot('intent-sync-outside-parent-')
    const root = join(parent, 'project')
    const outside = join(parent, 'outside')
    const priorTarget = join(parent, 'prior-source')
    mkdirSync(root)
    mkdirSync(join(outside, 'skills'), { recursive: true })
    mkdirSync(priorTarget)
    createDirectoryLink(outside, join(root, '.github'))
    const link = expected(root)

    const created = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult: { status: 'missing' },
    })
    expect(created.conflicts).toEqual([link.path])
    expect(existsSync(link.path)).toBe(false)

    createDirectoryLink(priorTarget, link.path)
    const priorEntry = ownedEntry(link, priorTarget)
    const stateResult = {
      status: 'found' as const,
      state: { version: 1 as const, entries: [priorEntry] },
    }
    const repair = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult,
    })
    const stale = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [],
      stateResult,
    })

    expect({
      repair: [repair.conflicts, repair.repaired, repair.entries],
      stale: [stale.conflicts, stale.removed, stale.entries],
    }).toEqual({
      repair: [[link.path], [], [priorEntry]],
      stale: [[link.path], [], [priorEntry]],
    })
    expect(lstatSync(link.path).isSymbolicLink()).toBe(true)
  })

  it('rejects persisted link paths that traverse outside the project', () => {
    const parent = tempRoot('intent-sync-state-path-')
    const root = join(parent, 'project')
    const outsideDirectory = join(parent, 'outside')
    const source = join(parent, 'source')
    const outsideLink = join(outsideDirectory, 'link')
    mkdirSync(join(root, '.intent'), { recursive: true })
    mkdirSync(outsideDirectory, { recursive: true })
    mkdirSync(source, { recursive: true })
    createDirectoryLink(source, outsideLink)
    writeFileSync(
      join(root, '.intent', 'install-state.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            targetDirectory: '../outside',
            path: '../outside/link',
            alias: 'link',
            source: { kind: 'npm', id: 'pkg' },
            skillPath: 'skills/core',
            linkTarget: source,
          },
        ],
      }),
      'utf8',
    )

    const stateResult = readInstallStateForLinks(root)
    const result = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [],
      stateResult,
    })

    expect({
      stateStatus: stateResult.status,
      removed: result.removed,
      outsideLinkExists: existsSync(outsideLink),
    }).toEqual({
      stateStatus: 'malformed',
      removed: [],
      outsideLinkExists: true,
    })
  })

  it('creates, leaves unchanged, repairs owned links, and cleans owned stale links', () => {
    const root = tempRoot('intent-sync-links-')
    const link = expected(root)
    const first = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult: { status: 'missing' },
    })
    expect(first.created).toEqual([link.path])
    expect(lstatSync(link.path).isSymbolicLink()).toBe(true)
    const second = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: { version: 1, entries: first.entries },
      },
    })
    expect(second.unchanged).toEqual([link.path])
    unlinkSync(link.path)
    const repaired = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: { version: 1, entries: first.entries },
      },
    })
    expect(repaired.created).toEqual([link.path])
    const cleanup = reconcileManagedLinks({
      root,
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
    createDirectoryLink(join(root, 'somewhere-else'), link.path)
    const conflict = reconcileManagedLinks({
      root,
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
      root,
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
    createDirectoryLink(join(root, 'missing'), link.path)

    const result = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: {
          version: 1,
          entries: [ownedEntry(link)],
        },
      },
    })

    expect(result.conflicts).toEqual([link.path])
    expect(result.repaired).toEqual([])
  })

  it('keeps owned state and continues when removing a stale link fails', () => {
    const root = tempRoot('intent-sync-remove-failure-')
    const source = join(root, 'source')
    const blockedPath = join(root, '.github', 'skills', 'blocked')
    const removablePath = join(root, '.github', 'skills', 'removable')
    mkdirSync(source, { recursive: true })
    mkdirSync(join(root, '.github', 'skills'), { recursive: true })
    createDirectoryLink(source, blockedPath)
    createDirectoryLink(source, removablePath)
    const entries = [blockedPath, removablePath].map((path) => ({
      targetDirectory: '.github/skills',
      path,
      alias: path === blockedPath ? 'blocked' : 'removable',
      source: { kind: 'npm' as const, id: 'pkg' },
      skillPath: 'skills/core',
      linkTarget: source,
    }))

    const result = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [],
      stateResult: { status: 'found', state: { version: 1, entries } },
      removeLink: (path) => {
        if (path === blockedPath) return false
        unlinkSync(path)
        return true
      },
    })

    expect(result.conflicts).toEqual([blockedPath])
    expect(result.removed).toEqual([removablePath])
    expect(result.entries).toEqual([entries[0]])
    expect(lstatSync(blockedPath).isSymbolicLink()).toBe(true)
    expect(existsSync(removablePath)).toBe(false)
  })

  it('records a fresh create failure and continues creating later links', () => {
    const root = tempRoot('intent-sync-create-failure-')
    const link = expected(root)
    const createdBefore = {
      ...link,
      path: join(dirname(link.path), 'a-created'),
    }
    const blocked = { ...link, path: join(dirname(link.path), 'm-blocked') }
    const created = { ...link, path: join(dirname(link.path), 'z-created') }
    mkdirSync(dirname(link.path), { recursive: true })

    const result = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [blocked, created, createdBefore],
      stateResult: { status: 'missing' },
      createLink: (path, target) => {
        if (path === blocked.path) return false
        createDirectoryLink(target, path)
        return true
      },
    })

    expect(result.conflicts).toEqual([blocked.path])
    expect(result.created).toEqual([createdBefore.path, created.path])
    expect(result.entries.map((entry) => entry.path)).toEqual([
      createdBefore.path,
      created.path,
    ])
    expect(existsSync(blocked.path)).toBe(false)
    expect(lstatSync(createdBefore.path).isSymbolicLink()).toBe(true)
    expect(lstatSync(created.path).isSymbolicLink()).toBe(true)
  })

  it('does not swallow unexpected creation errors', () => {
    const root = tempRoot('intent-sync-create-error-')
    const link = expected(root)

    expect(() =>
      reconcileManagedLinks({
        root,
        dryRun: false,
        expected: [link],
        stateResult: { status: 'missing' },
        createLink: () => {
          throw new Error('unexpected creation error')
        },
      }),
    ).toThrow('unexpected creation error')
  })

  it.each([
    { failure: 'removal', removeLink: () => false, linkRemains: true },
    { failure: 'creation', createLink: () => false, linkRemains: false },
  ])('retains prior state when owned-link repair $failure fails', (failure) => {
    const root = tempRoot('intent-sync-repair-failure-')
    const link = expected(root)
    const priorTarget = join(root, 'prior-source')
    mkdirSync(priorTarget, { recursive: true })
    mkdirSync(join(root, '.github', 'skills'), { recursive: true })
    createDirectoryLink(priorTarget, link.path)
    const priorEntry = ownedEntry(link, priorTarget)

    const result = reconcileManagedLinks({
      root,
      dryRun: false,
      expected: [link],
      stateResult: {
        status: 'found',
        state: { version: 1, entries: [priorEntry] },
      },
      createLink: failure.createLink,
      removeLink: failure.removeLink,
    })

    expect(result.conflicts).toEqual([link.path])
    expect(result.repaired).toEqual([])
    expect(result.entries).toEqual([priorEntry])
    expect(existsSync(link.path)).toBe(failure.linkRemains)
    if (failure.linkRemains)
      expect(lstatSync(link.path).isSymbolicLink()).toBe(true)
  })

  it('does not swallow unexpected removal errors', () => {
    const root = tempRoot('intent-sync-remove-error-')
    const source = join(root, 'source')
    const path = join(root, '.github', 'skills', 'owned')
    mkdirSync(source, { recursive: true })
    mkdirSync(join(root, '.github', 'skills'), { recursive: true })
    createDirectoryLink(source, path)

    expect(() =>
      reconcileManagedLinks({
        root,
        dryRun: false,
        expected: [],
        stateResult: {
          status: 'found',
          state: {
            version: 1,
            entries: [
              {
                targetDirectory: '.github/skills',
                path,
                alias: 'owned',
                source: { kind: 'npm', id: 'pkg' },
                skillPath: 'skills/core',
                linkTarget: source,
              },
            ],
          },
        },
        removeLink: () => {
          throw new Error('unexpected removal error')
        },
      }),
    ).toThrow('unexpected removal error')
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

  it('adds and preserves an idempotent prepare sync command', () => {
    expect(wireIntentSyncPrepare('{"name":"app"}\n')).toContain(
      '"prepare": "intent sync"',
    )
    expect(wireIntentSyncPrepare('{"scripts":{"prepare":"build"}}')).toContain(
      'build && intent sync',
    )
    const existing =
      '{\r\n  "scripts": { "prepare": "build && intent sync" }\r\n}\r\n'
    expect(wireIntentSyncPrepare(existing)).toBe(existing)
  })
})
