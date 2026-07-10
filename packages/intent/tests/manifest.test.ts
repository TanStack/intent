import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeManifestHash,
  generateManifest,
  parseManifest,
  readIntentManifest,
  serializeManifest,
  writeIntentManifest,
} from '../src/core/manifest.js'
import type { SkillEntry } from '../src/shared/types.js'

let packageRoot: string

beforeEach(() => {
  packageRoot = mkdtempSync(join(tmpdir(), 'manifest-test-'))
})

afterEach(() => {
  rmSync(packageRoot, { recursive: true, force: true })
})

function writeSkill(relDir: string, content: string): SkillEntry {
  const skillDir = join(packageRoot, relDir)
  mkdirSync(skillDir, { recursive: true })
  const filePath = join(skillDir, 'SKILL.md')
  writeFileSync(filePath, content)
  return {
    name: relDir.split('/').pop() ?? relDir,
    path: filePath,
    description: '',
  }
}

describe('generateManifest', () => {
  it('generates a manifest with no capabilities for plain content', () => {
    const skill = writeSkill('skills/core', '# Core\n\nJust guidance text.')

    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.manifest.package).toBe('@acme/pkg')
    expect(outcome.manifest.packageVersion).toBe('1.0.0')
    expect(outcome.manifest.skills).toHaveLength(1)
    expect(outcome.manifest.skills[0]).toMatchObject({
      name: 'core',
      path: 'skills/core/SKILL.md',
      capabilities: [],
      declaredSecrets: [],
    })
    expect(outcome.manifest.skills[0]?.contentHash).toMatch(/^sha256-/)
  })

  it('pre-fills uses_network from a curl/fetch reference', () => {
    const skill = writeSkill(
      'skills/net',
      'Run `curl https://example.com/api`.',
    )

    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.manifest.skills[0]?.capabilities).toContain('uses_network')
  })

  it('pre-fills runs_install_command from an install command reference', () => {
    const skill = writeSkill('skills/install', 'Run `npm install foo` first.')

    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.manifest.skills[0]?.capabilities).toContain(
      'runs_install_command',
    )
  })

  it('pre-fills ships_scripts when a non-empty scripts/ dir exists', () => {
    const skill = writeSkill('skills/scripted', 'Guidance text.')
    const scriptsDir = join(packageRoot, 'skills/scripted/scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(scriptsDir, 'run.sh'), '#!/bin/sh\necho hi')

    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.manifest.skills[0]?.capabilities).toContain('ships_scripts')
  })

  it('changes the content hash when a reference file changes, not just SKILL.md', () => {
    const skill = writeSkill('skills/withref', 'See references/notes.md.')
    const refDir = join(packageRoot, 'skills/withref/references')
    mkdirSync(refDir, { recursive: true })
    writeFileSync(join(refDir, 'notes.md'), 'original notes')

    const first = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(first.ok).toBe(true)
    if (!first.ok) return

    writeFileSync(join(refDir, 'notes.md'), 'changed notes')
    const second = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.manifest.skills[0]?.contentHash).not.toBe(
      first.manifest.skills[0]?.contentHash,
    )
  })

  it('hard-fails generation when a skill body contains a literal secret value', () => {
    const skill = writeSkill(
      'skills/leaky',
      'export GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef',
    )

    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.secretFindings).toEqual([
      { skillPath: 'skills/leaky/SKILL.md', patternName: 'github-token' },
    ])
  })

  it.each([
    ['references', 'notes.md'],
    ['assets', 'config.txt'],
    ['scripts', 'run.mjs'],
  ])(
    'hard-fails generation when %s/%s contains a literal secret value',
    (directory, fileName) => {
      const skill = writeSkill('skills/leaky', 'See supporting material.')
      const supportPath = join(packageRoot, 'skills/leaky', directory, fileName)
      mkdirSync(dirname(supportPath), { recursive: true })
      writeFileSync(
        supportPath,
        'export GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef',
      )

      const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [
        skill,
      ])

      expect(outcome).toEqual({
        ok: false,
        secretFindings: [
          {
            skillPath: `skills/leaky/${directory}/${fileName}`,
            patternName: 'github-token',
          },
        ],
      })
    },
  )
})

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
})

describe('serializeManifest / parseManifest round-trip', () => {
  it('round-trips a generated manifest', () => {
    const skill = writeSkill('skills/core', '# Core\n\nGuidance.')
    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const serialized = serializeManifest(outcome.manifest)
    const parsed = parseManifest(JSON.parse(serialized))
    expect(parsed).toEqual(outcome.manifest)
  })

  it('is deterministic: regenerating unchanged inputs serializes byte-identical', () => {
    const skill = writeSkill('skills/core', '# Core\n\nGuidance.')
    const first = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    const second = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    expect(serializeManifest(first.manifest)).toBe(
      serializeManifest(second.manifest),
    )
  })

  it('rejects a manifest with a duplicate skill path', () => {
    expect(() =>
      parseManifest({
        manifestVersion: 1,
        package: '@acme/pkg',
        packageVersion: '1.0.0',
        skills: [
          { name: 'a', path: 'skills/a/SKILL.md', contentHash: 'sha256-1' },
          { name: 'a2', path: 'skills/a/SKILL.md', contentHash: 'sha256-2' },
        ],
      }),
    ).toThrow(/duplicate skill path/)
  })

  it('rejects a manifest with a path escape', () => {
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

  it('rejects an unknown capability', () => {
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

  it('rejects MCP tools with undeclared fields', () => {
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
            mcpTools: [{ name: 'fetch', command: 'curl' }],
          },
        ],
      }),
    ).toThrow(/undeclared field/)
  })
})

describe('writeIntentManifest / readIntentManifest', () => {
  it('writes and reads back a manifest file', () => {
    const skill = writeSkill('skills/core', '# Core\n\nGuidance.')
    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const manifestPath = join(packageRoot, 'skills', 'intent.manifest.json')
    writeIntentManifest(manifestPath, outcome.manifest)

    const readBack = readIntentManifest(manifestPath)
    expect(readBack).toEqual(outcome.manifest)
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
  it('is stable for the same manifest content', () => {
    const skill = writeSkill('skills/core', '# Core\n\nGuidance.')
    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(computeManifestHash(outcome.manifest)).toBe(
      computeManifestHash(outcome.manifest),
    )
  })

  it('changes when a skill capability changes', () => {
    const skill = writeSkill('skills/core', '# Core\n\nGuidance.')
    const outcome = generateManifest(packageRoot, '@acme/pkg', '1.0.0', [skill])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const before = computeManifestHash(outcome.manifest)
    const mutated: typeof outcome.manifest = {
      ...outcome.manifest,
      skills: [
        {
          ...outcome.manifest.skills[0]!,
          capabilities: ['uses_network'],
        },
      ],
    }
    expect(computeManifestHash(mutated)).not.toBe(before)
  })

  it('canonicalizes declared arrays, tool order, and schema object keys', () => {
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

  it.each([
    [
      'declared secret',
      (manifest: ReturnType<typeof parseManifest>) => {
        manifest.skills[0]!.declaredSecrets = ['API_TOKEN']
      },
    ],
    [
      'MCP tool name',
      (manifest: ReturnType<typeof parseManifest>) => {
        manifest.skills[0]!.mcpTools = [{ name: 'fetch' }]
      },
    ],
    [
      'MCP tool description',
      (manifest: ReturnType<typeof parseManifest>) => {
        manifest.skills[0]!.mcpTools = [
          { name: 'fetch', description: 'Fetch a resource.' },
        ]
      },
    ],
    [
      'MCP tool schema',
      (manifest: ReturnType<typeof parseManifest>) => {
        manifest.skills[0]!.mcpTools = [
          { name: 'fetch', inputSchema: { type: 'object', required: ['url'] } },
        ]
      },
    ],
  ])('changes when a %s changes', (_, mutate) => {
    const manifest = parseManifest({
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
    const before = computeManifestHash(manifest)
    const mutated = structuredClone(manifest)

    mutate(mutated)

    expect(computeManifestHash(mutated)).not.toBe(before)
  })

  it('rejects MCP tools without a valid structural shape', () => {
    for (const mcpTools of [
      [{}],
      [{ name: 1 }],
      [{ name: 'fetch', description: 1 }],
      [{ name: 'fetch', inputSchema: [] }],
      [{ name: 'fetch', inputSchema: { type: undefined } }],
      [{ name: 'fetch' }, { name: 'fetch' }],
    ]) {
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
    }
  })
})
