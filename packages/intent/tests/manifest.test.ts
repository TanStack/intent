import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function writeSkill(
  relDir: string,
  content: string,
): SkillEntry {
  const skillDir = join(packageRoot, relDir)
  mkdirSync(skillDir, { recursive: true })
  const filePath = join(skillDir, 'SKILL.md')
  writeFileSync(filePath, content)
  return { name: relDir.split('/').pop() ?? relDir, path: filePath, description: '' }
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
    const skill = writeSkill('skills/net', 'Run `curl https://example.com/api`.')

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
    const mutated = {
      ...outcome.manifest,
      skills: [
        { ...outcome.manifest.skills[0]!, capabilities: ['uses_network'] },
      ],
    }
    expect(computeManifestHash(mutated)).not.toBe(before)
  })
})
