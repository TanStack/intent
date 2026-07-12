import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeManifestHash,
  parseManifest,
  readIntentManifest,
  serializeManifest,
  writeIntentManifest,
} from '../src/core/manifest.js'
import type { IntentManifest } from '../src/core/manifest.js'

let packageRoot: string

beforeEach(() => {
  packageRoot = mkdtempSync(join(tmpdir(), 'manifest-test-'))
})

afterEach(() => {
  rmSync(packageRoot, { recursive: true, force: true })
})

function manifestFixture(): IntentManifest {
  return parseManifest({
    manifestVersion: 1,
    package: '@acme/pkg',
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
}

describe('parseManifest', () => {
  it.each([
    [
      'root',
      {
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [],
        securityReview: 'unreviewed',
      },
    ],
    [
      'skill',
      {
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [
          {
            name: 'core',
            path: 'skills/core/SKILL.md',
            contentHash: 'sha256-core',
            extraMetadata: 'unreviewed',
          },
        ],
      },
    ],
  ])('rejects undeclared %s fields', (_label, manifest) => {
    expect(() => parseManifest(manifest)).toThrow(/undeclared field/)
  })

  it('rejects duplicate skill paths', () => {
    expect(() =>
      parseManifest({
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [
          { name: 'a', path: 'skills/a/SKILL.md', contentHash: 'sha256-1' },
          { name: 'b', path: 'skills/a/SKILL.md', contentHash: 'sha256-2' },
        ],
      }),
    ).toThrow(/duplicate skill path/)
  })

  it('rejects path escapes', () => {
    expect(() =>
      parseManifest({
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [
          { name: 'a', path: '../escape/SKILL.md', contentHash: 'sha256-1' },
        ],
      }),
    ).toThrow(/package-relative/)
  })

  it('rejects unknown capabilities', () => {
    expect(() =>
      parseManifest({
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [
          {
            name: 'core',
            path: 'skills/core/SKILL.md',
            contentHash: 'sha256-core',
            capabilities: ['unknown_capability'],
          },
        ],
      }),
    ).toThrow(/unknown capability/)
  })

  it.each([
    [{}],
    [{ name: 1 }],
    [{ name: 'fetch', description: 1 }],
    [{ name: 'fetch', inputSchema: [] }],
    [{ name: 'fetch', inputSchema: { type: undefined } }],
    [[{ name: 'fetch' }, { name: 'fetch' }]],
    [{ name: 'fetch', command: 'curl' }],
  ])('rejects invalid MCP tool metadata', (mcpTools) => {
    expect(() =>
      parseManifest({
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [
          {
            name: 'core',
            path: 'skills/core/SKILL.md',
            contentHash: 'sha256-core',
            mcpTools,
          },
        ],
      }),
    ).toThrow(/mcpTools/)
  })
})

describe('manifest serialization', () => {
  it('round-trips and serializes identical inputs byte-identically', () => {
    const manifest = manifestFixture()
    const serialized = serializeManifest(manifest)

    expect(parseManifest(JSON.parse(serialized))).toEqual(manifest)
    expect(serializeManifest(manifestFixture())).toBe(serialized)
  })

  it('canonicalizes arrays, tool order, and schema object keys', () => {
    const unsorted = parseManifest({
      manifestVersion: 1,
      package: '@acme/pkg',
      packageVersion: '1.0.0',
      skills: [
        {
          name: 'core',
          path: 'skills/core/SKILL.md',
          contentHash: 'sha256-core',
          capabilities: ['uses_network', 'runs_install_command'],
          declaredSecrets: ['Z_TOKEN', 'A_TOKEN'],
          mcpTools: [
            { name: 'zeta', inputSchema: { z: 1, a: { y: true, x: false } } },
            { name: 'alpha', description: 'Alpha tool.' },
          ],
        },
      ],
    })
    const sorted = parseManifest({
      manifestVersion: 1,
      package: '@acme/pkg',
      packageVersion: '1.0.0',
      skills: [
        {
          name: 'core',
          path: 'skills/core/SKILL.md',
          contentHash: 'sha256-core',
          capabilities: ['runs_install_command', 'uses_network'],
          declaredSecrets: ['A_TOKEN', 'Z_TOKEN'],
          mcpTools: [
            { name: 'alpha', description: 'Alpha tool.' },
            { name: 'zeta', inputSchema: { a: { x: false, y: true }, z: 1 } },
          ],
        },
      ],
    })

    expect(serializeManifest(unsorted)).toBe(serializeManifest(sorted))
    expect(computeManifestHash(unsorted)).toBe(computeManifestHash(sorted))
  })
})

describe('readIntentManifest', () => {
  it('writes and reads back a manifest file', () => {
    const manifest = manifestFixture()
    const manifestPath = join(packageRoot, 'skills', 'intent.manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true })

    writeIntentManifest(manifestPath, manifest)

    expect(readIntentManifest(manifestPath)).toEqual(manifest)
  })

  it('returns null when the manifest file does not exist', () => {
    expect(readIntentManifest(join(packageRoot, 'nope.json'))).toBeNull()
  })

  it('fails when an existing manifest is malformed', () => {
    const manifestPath = join(packageRoot, 'skills', 'intent.manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, '{not json')

    expect(() => readIntentManifest(manifestPath)).toThrow(
      /Invalid intent.manifest.json/,
    )
  })
})

describe('computeManifestHash', () => {
  it('is stable for identical content and changes with disclosures', () => {
    const manifest = manifestFixture()
    const before = computeManifestHash(manifest)
    const changed = structuredClone(manifest)
    changed.skills[0]!.capabilities = ['uses_network']

    expect(computeManifestHash(manifest)).toBe(before)
    expect(computeManifestHash(changed)).not.toBe(before)
  })

  it.each([
    [
      'declared secret',
      (manifest: IntentManifest) => {
        manifest.skills[0]!.declaredSecrets = ['API_TOKEN']
      },
    ],
    [
      'MCP tool name',
      (manifest: IntentManifest) => {
        manifest.skills[0]!.mcpTools = [{ name: 'fetch' }]
      },
    ],
    [
      'MCP tool description',
      (manifest: IntentManifest) => {
        manifest.skills[0]!.mcpTools = [
          { name: 'fetch', description: 'Fetch a resource.' },
        ]
      },
    ],
    [
      'MCP tool schema',
      (manifest: IntentManifest) => {
        manifest.skills[0]!.mcpTools = [
          { name: 'fetch', inputSchema: { type: 'object' } },
        ]
      },
    ],
  ])('changes when a %s changes', (_label, mutate) => {
    const manifest = manifestFixture()
    const before = computeManifestHash(manifest)
    const changed = structuredClone(manifest)

    mutate(changed)

    expect(computeManifestHash(changed)).not.toBe(before)
  })
})
