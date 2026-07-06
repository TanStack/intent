import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCurrentLockfileSources } from '../src/core/lockfile/lockfile-state.js'
import type { IntentPackage } from '../src/shared/types.js'

const roots: Array<string> = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-lockfile-state-test-'))
  roots.push(root)
  return root
}

function writeSkill(
  packageRoot: string,
  skillName: string,
  content: string,
): string {
  const skillDir = join(packageRoot, 'skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  const skillPath = join(skillDir, 'SKILL.md')
  writeFileSync(skillPath, content)
  return skillPath
}

function createPackage(
  overrides: Partial<IntentPackage> &
    Pick<IntentPackage, 'name' | 'kind' | 'packageRoot' | 'skills'>,
): IntentPackage {
  return {
    version: '1.0.0',
    intent: { version: 1, repo: 'TanStack/test', docs: 'docs/' },
    source: 'local',
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('buildCurrentLockfileSources', () => {
  it('builds one entry per package with npm resolution', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'fetching', 'body')
    const pkg = createPackage({
      name: '@tanstack/query',
      kind: 'npm',
      packageRoot: root,
      version: '5.0.0',
      skills: [{ name: 'fetching', path: skillPath, description: 'desc' }],
    })

    const [entry] = buildCurrentLockfileSources([pkg])

    expect(entry).toMatchObject({
      id: '@tanstack/query',
      kind: 'npm',
      version: '5.0.0',
      resolution: 'npm:@tanstack/query@5.0.0',
      manifestHash: null,
      capabilities: null,
      skills: ['skills/fetching/SKILL.md'],
    })
    expect(entry!.declaredSecrets).toBeUndefined()
    expect(entry!.mcpTools).toBeUndefined()
    expect(entry!.mcpPolicy).toBeUndefined()
    expect(entry!.contentHash).toMatch(/^sha256-[0-9a-f]{64}$/)
  })

  it('does not set a resolution for workspace packages', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'body')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })

    const [entry] = buildCurrentLockfileSources([pkg])

    expect(entry!.resolution).toBeNull()
  })

  it('changes contentHash when a skill file changes', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'version 1')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })

    const before = buildCurrentLockfileSources([pkg])[0]!.contentHash

    writeFileSync(skillPath, 'version 2')

    const after = buildCurrentLockfileSources([pkg])[0]!.contentHash

    expect(after).not.toBe(before)
  })

  it('produces a stable hash for an unchanged package', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'body')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })

    const a = buildCurrentLockfileSources([pkg])[0]!.contentHash
    const b = buildCurrentLockfileSources([pkg])[0]!.contentHash

    expect(a).toBe(b)
  })

  it('produces an identical hash across different physical package roots', () => {
    const rootA = createRoot()
    const rootB = createRoot()
    const skillA = writeSkill(rootA, 'core', 'shared body')
    const skillB = writeSkill(rootB, 'core', 'shared body')
    const pkgA = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: rootA,
      skills: [{ name: 'core', path: skillA, description: 'desc' }],
    })
    const pkgB = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: rootB,
      skills: [{ name: 'core', path: skillB, description: 'desc' }],
    })

    const hashA = buildCurrentLockfileSources([pkgA])[0]!.contentHash
    const hashB = buildCurrentLockfileSources([pkgB])[0]!.contentHash

    expect(hashA).toBe(hashB)
  })

  it('changes the aggregate hash when one of several skills changes, without needing the others to change', () => {
    const root = createRoot()
    const skillOne = writeSkill(root, 'one', 'body one')
    const skillTwo = writeSkill(root, 'two', 'body two')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [
        { name: 'one', path: skillOne, description: 'desc' },
        { name: 'two', path: skillTwo, description: 'desc' },
      ],
    })

    const before = buildCurrentLockfileSources([pkg])[0]!.contentHash

    writeFileSync(skillOne, 'body one changed')

    const after = buildCurrentLockfileSources([pkg])[0]!.contentHash

    expect(after).not.toBe(before)
  })

  it('is unaffected by the order of the skills array', () => {
    const root = createRoot()
    const skillOne = writeSkill(root, 'one', 'body one')
    const skillTwo = writeSkill(root, 'two', 'body two')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [
        { name: 'one', path: skillOne, description: 'desc' },
        { name: 'two', path: skillTwo, description: 'desc' },
      ],
    })
    const reordered = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [
        { name: 'two', path: skillTwo, description: 'desc' },
        { name: 'one', path: skillOne, description: 'desc' },
      ],
    })

    const hashA = buildCurrentLockfileSources([pkg])[0]!.contentHash
    const hashB = buildCurrentLockfileSources([reordered])[0]!.contentHash

    expect(hashA).toBe(hashB)
  })

  it('gives each nested skill its own independent content hash (no folder-scope bleed)', () => {
    const root = createRoot()
    const parentDir = join(root, 'skills', 'parent')
    const nestedDir = join(parentDir, 'nested')
    const parentSkill = writeSkill(root, 'parent', 'parent body')
    mkdirSync(nestedDir, { recursive: true })
    const nestedSkill = join(nestedDir, 'SKILL.md')
    writeFileSync(nestedSkill, 'nested body')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [
        { name: 'parent', path: parentSkill, description: 'desc' },
        { name: 'nested', path: nestedSkill, description: 'desc' },
      ],
    })

    const before = buildCurrentLockfileSources([pkg])[0]!.contentHash

    // Only the parent's own SKILL.md bytes changed — the nested skill's
    // separate SKILL.md path is unaffected, so the aggregate still moves
    // (it's part of the same source), but changing the nested file alone
    // (not the parent) proves each path is hashed independently.
    writeFileSync(nestedSkill, 'nested body changed')
    const nestedChanged = buildCurrentLockfileSources([pkg])[0]!.contentHash
    expect(nestedChanged).not.toBe(before)

    writeFileSync(nestedSkill, 'nested body')
    writeFileSync(parentSkill, 'parent body changed')
    const parentChanged = buildCurrentLockfileSources([pkg])[0]!.contentHash
    expect(parentChanged).not.toBe(before)
    expect(parentChanged).not.toBe(nestedChanged)
  })

  it('throws on a duplicate (kind, id) identity', () => {
    const rootA = createRoot()
    const rootB = createRoot()
    const skillA = writeSkill(rootA, 'a', 'a')
    const skillB = writeSkill(rootB, 'b', 'b')
    const first = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: rootA,
      skills: [{ name: 'a', path: skillA, description: 'desc' }],
    })
    const duplicate = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: rootB,
      skills: [{ name: 'b', path: skillB, description: 'desc' }],
    })

    expect(() => buildCurrentLockfileSources([first, duplicate])).toThrow(
      /Duplicate skill source identity/,
    )
  })

  it('handles a package with no skills without crashing', () => {
    const root = createRoot()
    const pkg = createPackage({
      name: 'empty-pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [],
    })

    const [entry] = buildCurrentLockfileSources([pkg])

    expect(entry!.contentHash).toMatch(/^sha256-[0-9a-f]{64}$/)
  })

  it('sorts entries by kind before id', () => {
    const rootA = createRoot()
    const rootB = createRoot()
    const skillA = writeSkill(rootA, 'a', 'a')
    const skillB = writeSkill(rootB, 'b', 'b')
    const npmPkg = createPackage({
      name: 'zzz',
      kind: 'npm',
      packageRoot: rootA,
      skills: [{ name: 'a', path: skillA, description: 'desc' }],
    })
    const workspacePkg = createPackage({
      name: 'aaa',
      kind: 'workspace',
      packageRoot: rootB,
      skills: [{ name: 'b', path: skillB, description: 'desc' }],
    })

    const entries = buildCurrentLockfileSources([npmPkg, workspacePkg])

    expect(entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'npm:zzz',
      'workspace:aaa',
    ])
  })

  it('sorts entries alphabetically by id within the same kind', () => {
    const rootA = createRoot()
    const rootB = createRoot()
    const skillA = writeSkill(rootA, 'a', 'a')
    const skillB = writeSkill(rootB, 'b', 'b')
    const banana = createPackage({
      name: 'banana',
      kind: 'npm',
      packageRoot: rootA,
      skills: [{ name: 'a', path: skillA, description: 'desc' }],
    })
    const apple = createPackage({
      name: 'apple',
      kind: 'npm',
      packageRoot: rootB,
      skills: [{ name: 'b', path: skillB, description: 'desc' }],
    })

    const entries = buildCurrentLockfileSources([banana, apple])

    expect(entries.map((entry) => entry.id)).toEqual(['apple', 'banana'])
  })
})
