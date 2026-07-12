import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { computeLockfileState } from '../src/commands/skills/support.js'
import { computeSkillFolderHash } from '../src/core/lockfile/hash.js'
import { buildCurrentLockfileSources } from '../src/core/lockfile/lockfile-state.js'
import { writeIntentManifest } from '../src/core/manifest.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type {
  IntentManifest,
  IntentManifestCapability,
} from '../src/core/manifest.js'
import type { IntentPackage, ScanResult } from '../src/shared/types.js'
import type { ReadFs } from '../src/shared/utils.js'

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

function createManifest(
  pkg: IntentPackage,
  capabilities: Array<IntentManifestCapability> = [],
): IntentManifest {
  return {
    manifestVersion: 1,
    package: pkg.name,
    packageVersion: pkg.version,
    skills: pkg.skills.map((skill) => ({
      name: skill.name,
      path: relative(pkg.packageRoot, skill.path).split('\\').join('/'),
      contentHash: computeSkillFolderHash(dirname(skill.path), pkg.packageRoot),
      capabilities,
      declaredSecrets: [],
      mcpTools: [],
    })),
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

  it('populates manifestHash and capabilities when the package ships a manifest', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'net', 'Run `curl https://example.com`.')
    const pkg = createPackage({
      name: '@acme/pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [{ name: 'net', path: skillPath, description: 'desc' }],
    })

    writeIntentManifest(
      join(root, 'skills', 'intent.manifest.json'),
      createManifest(pkg, ['uses_network']),
    )

    const [entry] = buildCurrentLockfileSources([pkg])

    expect(entry!.manifestHash).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(entry!.capabilities).toEqual(['uses_network'])
  })

  it('uses an empty capabilities array when a manifest declares none', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'plain guidance')
    const pkg = createPackage({
      name: '@acme/pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })
    writeIntentManifest(
      join(root, 'skills', 'intent.manifest.json'),
      createManifest(pkg),
    )

    const [entry] = buildCurrentLockfileSources([pkg])

    expect(entry!.manifestHash).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(entry!.capabilities).toEqual([])
  })

  it('projects manifest declarations into deterministic lock state', () => {
    const root = createRoot()
    const firstSkillPath = writeSkill(root, 'first', 'first guidance')
    const secondSkillPath = writeSkill(root, 'second', 'second guidance')
    const pkg = createPackage({
      name: '@acme/pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [
        { name: 'first', path: firstSkillPath, description: 'first' },
        { name: 'second', path: secondSkillPath, description: 'second' },
      ],
    })
    const manifest = createManifest(pkg)
    manifest.skills[0]!.declaredSecrets = ['Z_TOKEN', 'A_TOKEN']
    manifest.skills[0]!.mcpTools = [{ name: 'zeta' }, { name: 'alpha' }]
    manifest.skills[1]!.declaredSecrets = ['A_TOKEN']
    manifest.skills[1]!.mcpTools = [
      { name: 'alpha', description: 'duplicate declaration' },
    ]
    writeIntentManifest(join(root, 'skills', 'intent.manifest.json'), manifest)

    const [entry] = buildCurrentLockfileSources([pkg])

    expect(entry!.declaredSecrets).toEqual(['A_TOKEN', 'Z_TOKEN'])
    expect(entry!.mcpTools).toEqual(['alpha', 'zeta'])
  })

  it('fails when an existing manifest is malformed', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'body')
    const pkg = createPackage({
      name: '@acme/pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })
    writeFileSync(join(root, 'skills', 'intent.manifest.json'), '{not json')

    expect(() => buildCurrentLockfileSources([pkg])).toThrow(
      /Invalid intent.manifest.json/,
    )
  })

  it.each([
    ['package name', { package: '@acme/other' }],
    ['package version', { packageVersion: '2.0.0' }],
    ['skill set', { skills: [] }],
    [
      'skill content hash',
      {
        skills: [
          {
            name: 'core',
            path: 'skills/core/SKILL.md',
            contentHash: 'sha256-stale',
            capabilities: [],
            declaredSecrets: [],
            mcpTools: [],
          },
        ],
      },
    ],
  ])('fails when a manifest has a mismatched %s', (_, override) => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'body')
    const pkg = createPackage({
      name: '@acme/pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })
    const manifest = createManifest(pkg)
    writeFileSync(
      join(root, 'skills', 'intent.manifest.json'),
      JSON.stringify({ ...manifest, ...override }),
    )

    expect(() => buildCurrentLockfileSources([pkg])).toThrow(/does not match/)
  })

  it.each([
    [
      'declared secrets',
      {
        declaredSecrets: ['API_TOKEN'],
        mcpTools: [],
      },
    ],
    [
      'an MCP tool name',
      {
        declaredSecrets: [],
        mcpTools: [{ name: 'fetch' }],
      },
    ],
    [
      'an MCP tool description',
      {
        declaredSecrets: [],
        mcpTools: [{ name: 'fetch', description: 'Fetch a resource.' }],
      },
    ],
    [
      'an MCP tool schema',
      {
        declaredSecrets: [],
        mcpTools: [{ name: 'fetch', inputSchema: { type: 'object' } }],
      },
    ],
  ])('changes manifestHash when %s changes', (_, disclosure) => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'body')
    const pkg = createPackage({
      name: '@acme/pkg',
      kind: 'npm',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })
    const manifestPath = join(root, 'skills', 'intent.manifest.json')
    const baseManifest = createManifest(pkg)
    writeFileSync(manifestPath, JSON.stringify(baseManifest))
    const before = buildCurrentLockfileSources([pkg])[0]!.manifestHash

    const changedManifest = structuredClone(baseManifest)
    Object.assign(changedManifest.skills[0]!, disclosure)
    writeFileSync(manifestPath, JSON.stringify(changedManifest))

    expect(buildCurrentLockfileSources([pkg])[0]!.manifestHash).not.toBe(before)
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

  it('reads source bytes through the scanner filesystem', () => {
    const root = createRoot()
    const skillPath = writeSkill(root, 'core', 'native bytes')
    const pkg = createPackage({
      name: 'router',
      kind: 'workspace',
      packageRoot: root,
      skills: [{ name: 'core', path: skillPath, description: 'desc' }],
    })
    const realSkillPath = nodeReadFs.realpathSync(skillPath)
    const readFs: ReadFs = {
      ...nodeReadFs,
      readFileSync: ((path: string | Buffer | URL | number) => {
        if (String(path) === realSkillPath) {
          return Buffer.from('patched zip bytes')
        }
        return nodeReadFs.readFileSync(path)
      }) as typeof nodeReadFs.readFileSync,
    }

    const nativeHash = buildCurrentLockfileSources([pkg])[0]!.contentHash
    const scan: ScanResult = {
      packageManager: 'yarn',
      packages: [pkg],
      warnings: [],
      notices: [],
      conflicts: [],
      nodeModules: {
        local: { path: null, detected: false, exists: false, scanned: false },
        global: { path: null, detected: false, exists: false, scanned: false },
      },
      stats: { packageJsonReadCount: 0, packageJsonCacheHits: 0 },
      readFs,
    }
    const patchedHash = computeLockfileState(scan, root).current[0]!.contentHash

    expect(patchedHash).not.toBe(nativeHash)
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
