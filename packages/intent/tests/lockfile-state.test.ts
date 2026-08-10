import {
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCurrentLockfileSources } from '../src/core/lockfile/lockfile-state.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type { IntentPackage } from '../src/shared/types.js'
import type { ReadFs } from '../src/shared/utils.js'

const roots: Array<string> = []

function createPackage(
  overrides: Partial<Omit<IntentPackage, 'packageRoot'>> = {},
): IntentPackage {
  const packageRoot = mkdtempSync(join(tmpdir(), 'intent-lock-state-test-'))
  roots.push(packageRoot)
  return {
    name: 'pkg',
    version: '1.0.0',
    intent: { version: 1, repo: 'repo', docs: 'docs' },
    skills: [],
    packageRoot,
    kind: 'npm',
    source: 'local',
    ...overrides,
  }
}

function writeSkill(
  packageRoot: string,
  name: string,
  files: ReadonlyArray<readonly [string, string]> = [
    ['SKILL.md', `# ${name}\n`],
  ],
): void {
  const skillRoot = join(packageRoot, 'skills', name)
  for (const [path, content] of files) {
    const filePath = join(skillRoot, path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('buildCurrentLockfileSources', () => {
  it('constructs one canonical source from a discovered skill', () => {
    const pkg = createPackage({
      name: '@tanstack/query',
      version: '5.0.0',
      skills: [
        {
          name: 'query/cache',
          path: '/mutable/discovery/path/SKILL.md',
          description: 'Cache skill',
        },
      ],
    })
    writeSkill(pkg.packageRoot, 'query/cache', [
      [
        'SKILL.md',
        '---\nname: pinned\ndescription: Pinned hash fixture\n---\n',
      ],
      ['references/zeta.md', 'Zeta\n'],
      ['references/alpha.md', 'Alpha\r\n'],
    ])

    const sources = buildCurrentLockfileSources([pkg])

    expect(sources).toEqual([
      {
        kind: 'npm',
        id: '@tanstack/query',
        observedVersion: '5.0.0',
        skills: [
          {
            path: 'skills/query/cache',
            contentHash:
              'sha256-985f0fe3329f5eb4cbf3202c9d34da0c53d404292423a15a25d914b7fadc6ce7',
          },
        ],
      },
    ])
    expect(sources[0]!.skills[0]!.path).not.toMatch(/\/SKILL\.md$/)
  })

  it('sorts sources and skills without mutating discovered packages', () => {
    const zeta = createPackage({
      name: 'zeta',
      skills: [
        { name: 'z', path: 'mutable-z', description: 'Z' },
        { name: 'a', path: 'mutable-a', description: 'A' },
      ],
    })
    const alpha = createPackage({
      name: 'alpha',
      skills: [
        { name: 'c', path: 'mutable-c', description: 'C' },
        { name: 'b', path: 'mutable-b', description: 'B' },
      ],
    })
    for (const pkg of [zeta, alpha]) {
      for (const skill of pkg.skills) {
        writeSkill(pkg.packageRoot, skill.name)
      }
    }
    const packages = [zeta, alpha]
    const original = structuredClone(packages)

    const sources = buildCurrentLockfileSources(packages)

    expect(
      sources.map((source) => ({
        id: source.id,
        paths: source.skills.map((skill) => skill.path),
      })),
    ).toEqual([
      { id: 'alpha', paths: ['skills/b', 'skills/c'] },
      { id: 'zeta', paths: ['skills/a', 'skills/z'] },
    ])
    expect(packages).toEqual(original)
  })

  it('keeps npm and workspace sources with the same id distinct', () => {
    const npmPackage = createPackage({
      name: 'shared',
      kind: 'npm',
      skills: [{ name: 'npm', path: 'npm', description: 'npm' }],
    })
    const workspacePackage = createPackage({
      name: 'shared',
      version: '',
      kind: 'workspace',
      skills: [
        { name: 'workspace', path: 'workspace', description: 'workspace' },
      ],
    })
    writeSkill(npmPackage.packageRoot, 'npm')
    writeSkill(workspacePackage.packageRoot, 'workspace')

    const sources = buildCurrentLockfileSources([workspacePackage, npmPackage])

    expect(
      sources.map(({ kind, id, observedVersion }) => ({
        kind,
        id,
        observedVersion,
      })),
    ).toEqual([
      { kind: 'npm', id: 'shared', observedVersion: '1.0.0' },
      { kind: 'workspace', id: 'shared', observedVersion: '' },
    ])
  })

  it('ignores skill.path for identity and hashing', () => {
    const pkg = createPackage({
      skills: [
        {
          name: 'actual',
          path: '../../outside\\\u202e/SKILL.md',
          description: 'Actual skill',
        },
      ],
    })
    writeSkill(pkg.packageRoot, 'actual', [
      [
        'SKILL.md',
        '---\nname: pinned\ndescription: Pinned hash fixture\n---\n',
      ],
      ['references/zeta.md', 'Zeta\n'],
      ['references/alpha.md', 'Alpha\r\n'],
    ])

    const [source] = buildCurrentLockfileSources([pkg])

    expect(source!.skills).toEqual([
      {
        path: 'skills/actual',
        contentHash:
          'sha256-985f0fe3329f5eb4cbf3202c9d34da0c53d404292423a15a25d914b7fadc6ce7',
      },
    ])
  })

  it('rejects duplicate source identities', () => {
    const first = createPackage({ name: 'duplicate' })
    const second = createPackage({ name: 'duplicate' })

    expect(() => buildCurrentLockfileSources([first, second])).toThrow(
      'Duplicate source: npm:duplicate',
    )
  })

  it('rejects duplicate skill names within a source', () => {
    const pkg = createPackage({
      skills: [
        { name: 'duplicate', path: 'first', description: 'First' },
        { name: 'duplicate', path: 'second', description: 'Second' },
      ],
    })
    writeSkill(pkg.packageRoot, 'duplicate')

    expect(() => buildCurrentLockfileSources([pkg])).toThrow(
      'Duplicate skill path: skills/duplicate',
    )
  })

  it.each([
    ['absolute', '/absolute'],
    ['traversal', '../outside'],
    ['backslash', 'query\\cache'],
    ['control character', 'query\u0000cache'],
    ['bidi control', 'query\u202ecache'],
    ['empty segment', 'query//cache'],
  ])('rejects an invalid %s skill name', (_case, name) => {
    const pkg = createPackage({
      skills: [{ name, path: 'ignored', description: 'Invalid' }],
    })

    expect(() => buildCurrentLockfileSources([pkg])).toThrow()
  })

  it.each([
    ['skill directory', false, 'Skill root is unreadable'],
    ['root SKILL.md', true, 'Skill root SKILL.md is required'],
  ])(
    'rejects a missing %s without returning partial sources',
    (_case, createRoot, message) => {
      const pkg = createPackage({
        skills: [
          { name: 'valid', path: 'valid', description: 'Valid' },
          { name: 'missing', path: 'missing', description: 'Missing' },
        ],
      })
      writeSkill(pkg.packageRoot, 'valid')
      if (createRoot) {
        writeSkill(pkg.packageRoot, 'missing', [['notes.md', 'No skill file']])
      }

      expect(() => buildCurrentLockfileSources([pkg])).toThrow(message)
    },
  )

  it('accepts empty packages and packages with no skills', () => {
    expect(buildCurrentLockfileSources([])).toEqual([])

    const pkg = createPackage({ name: 'empty' })
    expect(buildCurrentLockfileSources([pkg])).toEqual([
      {
        kind: 'npm',
        id: 'empty',
        observedVersion: '1.0.0',
        skills: [],
      },
    ])
  })

  it('passes an injected ReadFs through to skill hashing', () => {
    const pkg = createPackage({
      skills: [{ name: 'injected', path: 'ignored', description: 'Injected' }],
    })
    writeSkill(pkg.packageRoot, 'injected')
    const calls = { opendir: 0, open: 0, fstat: 0 }
    const injectedFs: ReadFs = {
      ...nodeReadFs,
      opendirSync: ((...args: Array<unknown>) => {
        calls.opendir += 1
        return Reflect.apply(opendirSync, undefined, args)
      }) as ReadFs['opendirSync'],
      openSync: ((...args: Array<unknown>) => {
        calls.open += 1
        return Reflect.apply(openSync, undefined, args)
      }) as NonNullable<ReadFs['openSync']>,
      fstatSync: ((...args: Array<unknown>) => {
        calls.fstat += 1
        return Reflect.apply(fstatSync, undefined, args)
      }) as NonNullable<ReadFs['fstatSync']>,
    }

    buildCurrentLockfileSources([pkg], injectedFs)

    expect(calls.opendir).toBeGreaterThan(0)
    expect(calls.open).toBeGreaterThan(0)
    expect(calls.fstat).toBeGreaterThan(0)
  })

  it('includes nested child content in both parent and child hashes', () => {
    const pkg = createPackage({
      skills: [
        { name: 'parent', path: 'parent', description: 'Parent' },
        {
          name: 'parent/child',
          path: 'parent/child',
          description: 'Child',
        },
      ],
    })
    writeSkill(pkg.packageRoot, 'parent', [['SKILL.md', 'Parent\n']])
    writeSkill(pkg.packageRoot, 'parent/child', [['SKILL.md', 'Child\n']])
    const before = buildCurrentLockfileSources([pkg])[0]!.skills

    writeFileSync(
      join(pkg.packageRoot, 'skills', 'parent', 'child', 'SKILL.md'),
      'Child changed\n',
    )
    const after = buildCurrentLockfileSources([pkg])[0]!.skills

    expect(after.map((skill) => skill.path)).toEqual([
      'skills/parent',
      'skills/parent/child',
    ])
    expect(after[0]!.contentHash).not.toBe(before[0]!.contentHash)
    expect(after[1]!.contentHash).not.toBe(before[1]!.contentHash)
  })

  it('retains exact package versions including an empty workspace version', () => {
    const npmPackage = createPackage({
      name: 'npm-version',
      version: '1.2.3-beta.1+build.7',
    })
    const workspacePackage = createPackage({
      name: 'workspace-version',
      version: '',
      kind: 'workspace',
    })

    const sources = buildCurrentLockfileSources([workspacePackage, npmPackage])

    expect(
      sources.map(({ kind, observedVersion }) => ({ kind, observedVersion })),
    ).toEqual([
      { kind: 'npm', observedVersion: '1.2.3-beta.1+build.7' },
      { kind: 'workspace', observedVersion: '' },
    ])
  })

  it.each([
    ['empty source id', { name: '' }, 'sources[0].id must not be empty'],
    [
      'empty npm version',
      { version: '' },
      'sources[0].observedVersion must not be empty',
    ],
  ])('rejects an %s', (_case, overrides, message) => {
    const pkg = createPackage(overrides)

    expect(() => buildCurrentLockfileSources([pkg])).toThrow(message)
  })
})
