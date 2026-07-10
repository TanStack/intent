import { describe, expect, it } from 'vitest'
import { diffLockfileSources } from '../src/core/lockfile/lockfile-diff.js'
import { computeManifestHash, parseManifest } from '../src/core/manifest.js'
import type {
  IntentLockfile,
  IntentLockfileSource,
} from '../src/core/lockfile/lockfile.js'

function createSource(
  overrides: Partial<IntentLockfileSource> &
    Pick<IntentLockfileSource, 'id' | 'kind'>,
): IntentLockfileSource {
  return {
    version: '1.0.0',
    resolution: null,
    skills: [],
    manifestHash: null,
    contentHash: 'sha256-aaa',
    capabilities: null,
    ...overrides,
  }
}

function createLockfile(sources: Array<IntentLockfileSource>): IntentLockfile {
  return {
    lockfileVersion: 1,
    intentVersion: '1.0.0',
    sources,
    policy: { ignores: [] },
  }
}

describe('diffLockfileSources', () => {
  it('reports no lockfile as not clean with nothing itemized', () => {
    const result = diffLockfileSources([], { status: 'missing' })

    expect(result).toEqual({
      hasLockfile: false,
      added: [],
      removed: [],
      changed: [],
      isClean: false,
    })
  })

  it('reports clean when current matches the lockfile exactly', () => {
    const source = createSource({ id: '@tanstack/router', kind: 'npm' })

    const result = diffLockfileSources([source], {
      status: 'found',
      lockfile: createLockfile([source]),
    })

    expect(result.isClean).toBe(true)
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
  })

  it('reports a new source as added', () => {
    const current = createSource({ id: '@tanstack/router', kind: 'npm' })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([]),
    })

    expect(result.isClean).toBe(false)
    expect(result.added).toEqual([current])
    expect(result.removed).toEqual([])
  })

  it('reports a missing source as removed', () => {
    const locked = createSource({ id: '@tanstack/router', kind: 'npm' })

    const result = diffLockfileSources([], {
      status: 'found',
      lockfile: createLockfile([locked]),
    })

    expect(result.isClean).toBe(false)
    expect(result.removed).toEqual([locked])
    expect(result.added).toEqual([])
  })

  it('reports a version change', () => {
    const locked = createSource({
      id: '@tanstack/router',
      kind: 'npm',
      version: '1.0.0',
    })
    const current = createSource({
      id: '@tanstack/router',
      kind: 'npm',
      version: '1.1.0',
    })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([locked]),
    })

    expect(result.isClean).toBe(false)
    expect(result.changed).toEqual([
      {
        id: '@tanstack/router',
        kind: 'npm',
        fields: [{ field: 'version', from: '1.0.0', to: '1.1.0' }],
      },
    ])
  })

  it('reports a contentHash change', () => {
    const locked = createSource({
      id: 'router',
      kind: 'workspace',
      contentHash: 'sha256-aaa',
    })
    const current = createSource({
      id: 'router',
      kind: 'workspace',
      contentHash: 'sha256-bbb',
    })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([locked]),
    })

    expect(result.changed).toEqual([
      {
        id: 'router',
        kind: 'workspace',
        fields: [
          { field: 'contentHash', from: 'sha256-aaa', to: 'sha256-bbb' },
        ],
      },
    ])
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
  ])('reports manifestHash drift when %s changes', (_, disclosure) => {
    const baseManifest = parseManifest({
      manifestVersion: 1,
      package: 'foo',
      packageVersion: '1.0.0',
      skills: [
        {
          name: 'core',
          path: 'skills/core/SKILL.md',
          contentHash: 'sha256-core',
          capabilities: [],
          declaredSecrets: [],
          mcpTools: [],
        },
      ],
    })
    const changedManifest = structuredClone(baseManifest)
    Object.assign(changedManifest.skills[0]!, disclosure)
    const locked = createSource({
      id: 'foo',
      kind: 'npm',
      manifestHash: computeManifestHash(baseManifest),
    })
    const current = createSource({
      id: 'foo',
      kind: 'npm',
      manifestHash: computeManifestHash(changedManifest),
    })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([locked]),
    })

    expect(result.changed).toEqual([
      {
        id: 'foo',
        kind: 'npm',
        fields: [
          {
            field: 'manifestHash',
            from: locked.manifestHash,
            to: current.manifestHash,
          },
        ],
      },
    ])
  })

  it('does not confuse a workspace source with an npm source of the same name', () => {
    const lockedNpm = createSource({ id: 'foo', kind: 'npm' })
    const currentWorkspace = createSource({ id: 'foo', kind: 'workspace' })

    const result = diffLockfileSources([currentWorkspace], {
      status: 'found',
      lockfile: createLockfile([lockedNpm]),
    })

    expect(result.added).toEqual([currentWorkspace])
    expect(result.removed).toEqual([lockedNpm])
    expect(result.changed).toEqual([])
  })

  it('is unaffected by array order differences in capabilities', () => {
    const locked = createSource({
      id: 'foo',
      kind: 'npm',
      capabilities: ['write', 'read'],
    })
    const current = createSource({
      id: 'foo',
      kind: 'npm',
      capabilities: ['read', 'write'],
    })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([locked]),
    })

    expect(result.isClean).toBe(true)
  })

  it('sorts added/removed by (kind, id)', () => {
    const lockedA = createSource({ id: 'b-pkg', kind: 'npm' })
    const currentX = createSource({ id: 'a-pkg', kind: 'npm' })
    const currentY = createSource({ id: 'c-pkg', kind: 'npm' })

    const result = diffLockfileSources([currentX, currentY], {
      status: 'found',
      lockfile: createLockfile([lockedA]),
    })

    expect(result.added.map((source) => source.id)).toEqual(['a-pkg', 'c-pkg'])
    expect(result.removed.map((source) => source.id)).toEqual(['b-pkg'])
  })

  it('reports multiple changed fields on the same source in one entry', () => {
    const locked = createSource({
      id: '@tanstack/router',
      kind: 'npm',
      version: '1.0.0',
      contentHash: 'sha256-aaa',
    })
    const current = createSource({
      id: '@tanstack/router',
      kind: 'npm',
      version: '1.1.0',
      contentHash: 'sha256-bbb',
    })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([locked]),
    })

    expect(result.changed).toEqual([
      {
        id: '@tanstack/router',
        kind: 'npm',
        fields: [
          { field: 'version', from: '1.0.0', to: '1.1.0' },
          { field: 'contentHash', from: 'sha256-aaa', to: 'sha256-bbb' },
        ],
      },
    ])
  })

  it('sorts multiple changed sources by (kind, id)', () => {
    const lockedA = createSource({
      id: 'b-pkg',
      kind: 'npm',
      version: '1.0.0',
    })
    const lockedB = createSource({
      id: 'a-pkg',
      kind: 'npm',
      version: '1.0.0',
    })
    const currentA = createSource({
      id: 'b-pkg',
      kind: 'npm',
      version: '2.0.0',
    })
    const currentB = createSource({
      id: 'a-pkg',
      kind: 'npm',
      version: '2.0.0',
    })

    const result = diffLockfileSources([currentA, currentB], {
      status: 'found',
      lockfile: createLockfile([lockedA, lockedB]),
    })

    expect(result.changed.map((change) => change.id)).toEqual([
      'a-pkg',
      'b-pkg',
    ])
  })

  it('canonicalizes added sources so array order does not leak through', () => {
    const current = createSource({
      id: '@tanstack/router',
      kind: 'npm',
      capabilities: ['write', 'read'],
    })

    const result = diffLockfileSources([current], {
      status: 'found',
      lockfile: createLockfile([]),
    })

    expect(result.added).toEqual([
      { ...current, capabilities: ['read', 'write'] },
    ])
  })
})
