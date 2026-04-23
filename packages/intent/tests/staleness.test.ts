import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkStaleness } from '../src/staleness.js'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string

function setupDir(): string {
  const dir = join(
    tmpdir(),
    `intent-stale-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeSkill(
  dir: string,
  name: string,
  fm: Record<string, unknown>,
  body = '# Skill\n',
): void {
  const skillDir = join(dir, 'skills', ...name.split('/'))
  mkdirSync(skillDir, { recursive: true })

  const fmStr = Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((i) => `  - ${i}`).join('\n')}`
      }
      return `${k}: ${v}`
    })
    .join('\n')

  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${fmStr}\n---\n${body}`)
}

function writeSyncState(dir: string, state: Record<string, unknown>): void {
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(join(skillsDir, 'sync-state.json'), JSON.stringify(state))
}

function writeArtifact(rootDir: string, fileName: string, content: string): void {
  const artifactsDir = join(rootDir, '_artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(join(artifactsDir, fileName), content)
}

function requireFirstSkill(report: Awaited<ReturnType<typeof checkStaleness>>) {
  const skill = report.skills[0]
  expect(skill).toBeDefined()
  if (!skill) throw new Error('Expected at least one skill in staleness report')
  return skill
}

// ---------------------------------------------------------------------------
// Mock fetch for npm registry
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

function mockFetchVersion(version: string): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ version }),
  } as Response)
}

function mockFetchNotOk(): void {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)
}

beforeEach(() => {
  tmpDir = setupDir()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkStaleness', () => {
  it('returns empty skills when no skills directory exists', async () => {
    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.library).toBe('@example/lib')
    expect(report.skills).toHaveLength(0)
    expect(report.currentVersion).toBeNull()
    expect(report.skillVersion).toBeNull()
    expect(report.versionDrift).toBeNull()
    expect(report.signals).toEqual([])
  })

  it('defaults library to "unknown" when no name provided', async () => {
    const report = await checkStaleness(tmpDir)
    expect(report.library).toBe('unknown')
  })

  it('detects skills from SKILL.md files', async () => {
    writeSkill(tmpDir, 'basics', {
      name: 'basics',
      description: 'Core concepts',
    })
    writeSkill(tmpDir, 'advanced', {
      name: 'advanced',
      description: 'Advanced usage',
    })

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills).toHaveLength(2)
    expect(report.skills.map((s) => s.name).sort()).toEqual([
      'advanced',
      'basics',
    ])
  })

  it('detects major version drift', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    mockFetchVersion('2.0.0')

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skillVersion).toBe('1.2.3')
    expect(report.currentVersion).toBe('2.0.0')
    expect(report.versionDrift).toBe('major')
    const skill = requireFirstSkill(report)
    expect(skill.needsReview).toBe(true)
    expect(skill.reasons[0]).toContain('version drift')
  })

  it('detects minor version drift', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    mockFetchVersion('1.4.0')

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.versionDrift).toBe('minor')
  })

  it('detects patch version drift', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    mockFetchVersion('1.2.5')

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.versionDrift).toBe('patch')
  })

  it('reports no drift when versions match', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    mockFetchVersion('1.2.3')

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.versionDrift).toBeNull()
    expect(requireFirstSkill(report).needsReview).toBe(false)
  })

  it('handles npm fetch failure gracefully', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.0.0',
    })

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.currentVersion).toBeNull()
    expect(report.versionDrift).toBeNull()
  })

  it('flags new sources not present in sync-state', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      sources: ['docs/api.md', 'docs/guide.md'],
    })

    writeSyncState(tmpDir, {
      skills: {
        core: {
          sources_sha: {
            'docs/api.md': 'abc123',
            // docs/guide.md intentionally missing
          },
        },
      },
    })

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')
    const skill = requireFirstSkill(report)
    expect(skill.needsReview).toBe(true)
    expect(skill.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('new source')]),
    )
  })

  it('does not flag sources when no sync-state exists', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      sources: ['docs/api.md'],
    })

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(requireFirstSkill(report).needsReview).toBe(false)
  })

  it('ignores malformed sync-state entries instead of flagging false positives', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      sources: ['docs/api.md'],
    })

    writeSyncState(tmpDir, {
      skills: {
        core: {
          sources_sha: ['not', 'a', 'record'],
        },
      },
    })

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')
    const skill = requireFirstSkill(report)
    expect(skill.needsReview).toBe(false)
    expect(skill.reasons).toEqual([])
  })

  it('handles nested skill directories', async () => {
    writeSkill(tmpDir, 'react/hooks', {
      name: 'react/hooks',
      description: 'React hooks',
      library_version: '1.0.0',
    })

    mockFetchVersion('2.0.0')

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills).toHaveLength(1)
    const skill = requireFirstSkill(report)
    expect(skill.name).toBe('react/hooks')
    expect(skill.needsReview).toBe(true)
  })

  it('uses directory name when frontmatter has no name', async () => {
    writeSkill(tmpDir, 'my-skill', {
      description: 'A skill with no name field',
    })

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(requireFirstSkill(report).name).toBe('my-skill')
  })

  it('uses skillVersion from first skill that has library_version', async () => {
    writeSkill(tmpDir, 'a', { name: 'a', description: 'No version' })
    writeSkill(tmpDir, 'b', {
      name: 'b',
      description: 'Has version',
      library_version: '3.5.0',
    })

    mockFetchVersion('4.0.0')

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skillVersion).toBe('3.5.0')
    expect(report.versionDrift).toBe('major')
  })

  it('handles malformed SKILL.md without crashing', async () => {
    const skillDir = join(tmpDir, 'skills', 'broken')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), 'no frontmatter here')

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills).toHaveLength(1)
    expect(requireFirstSkill(report).needsReview).toBe(false)
  })

  it('reads version from local package.json when npm fetch fails', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: '@private/lib', version: '2.5.0' }),
    )

    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '2.0.0',
    })

    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@private/lib')
    expect(report.currentVersion).toBe('2.5.0')
    expect(report.versionDrift).toBe('minor')
    const skill = requireFirstSkill(report)
    expect(skill.needsReview).toBe(true)
    expect(skill.reasons[0]).toContain('version drift')
  })

  it('prefers local package.json over npm registry', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: '@example/lib', version: '3.0.0' }),
    )

    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '2.0.0',
    })

    // npm returns an older published version
    mockFetchVersion('2.5.0')

    const report = await checkStaleness(tmpDir, '@example/lib')
    // Local package.json should take precedence
    expect(report.currentVersion).toBe('3.0.0')
    expect(report.versionDrift).toBe('major')
  })

  it('does not flag matching artifact skill metadata', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
      sources: ['docs/core.md'],
    })
    writeArtifact(
      tmpDir,
      'skill_tree.yaml',
      `
library:
  name: '@example/lib'
  version: '1.2.3'
skills:
  - name: 'Core'
    slug: 'core'
    path: 'skills/core/SKILL.md'
    package: '@example/lib'
    sources:
      - 'docs/core.md'
`,
    )
    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')

    expect(report.signals).toEqual([])
  })

  it('flags artifact skills whose generated SKILL.md is missing', async () => {
    writeArtifact(
      tmpDir,
      'skill_tree.yaml',
      `
library:
  name: '@example/lib'
  version: '1.2.3'
skills:
  - name: 'Missing'
    slug: 'missing'
    path: 'skills/missing/SKILL.md'
    package: '@example/lib'
`,
    )
    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')

    expect(report.signals).toEqual([
      expect.objectContaining({
        type: 'artifact-skill-missing',
        subject: 'missing',
        needsReview: true,
      }),
    ])
  })

  it('flags artifact sources that differ from SKILL.md frontmatter', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      sources: ['docs/current.md'],
    })
    writeArtifact(
      tmpDir,
      'skill_tree.yaml',
      `
library:
  name: '@example/lib'
skills:
  - name: 'Core'
    slug: 'core'
    path: 'skills/core/SKILL.md'
    package: '@example/lib'
    sources:
      - 'docs/artifact.md'
`,
    )
    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')

    expect(report.signals).toEqual([
      expect.objectContaining({
        type: 'artifact-source-drift',
        skill: 'core',
        needsReview: true,
      }),
    ])
  })

  it('flags artifact library version drift against matching SKILL.md frontmatter', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.0.0',
    })
    writeArtifact(
      tmpDir,
      'skill_tree.yaml',
      `
library:
  name: '@example/lib'
  version: '1.2.0'
skills:
  - name: 'Core'
    slug: 'core'
    path: 'skills/core/SKILL.md'
    package: '@example/lib'
`,
    )
    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')

    expect(report.signals).toEqual([
      expect.objectContaining({
        type: 'artifact-library-version-drift',
        skill: 'core',
        needsReview: true,
      }),
    ])
  })

  it('flags artifact parse warnings as review signals', async () => {
    writeArtifact(tmpDir, 'skill_tree.yaml', 'skills:\n  - name: [broken\n')
    mockFetchNotOk()

    const report = await checkStaleness(tmpDir, '@example/lib')

    expect(report.signals).toEqual([
      expect.objectContaining({
        type: 'artifact-parse-warning',
        needsReview: true,
      }),
    ])
  })

  it('uses the workspace artifact root for package-scoped artifact paths', async () => {
    const packageDir = join(tmpDir, 'packages', 'router')
    writeSkill(packageDir, 'routing', {
      name: 'routing',
      description: 'Routing',
      library_version: '1.0.0',
    })
    writeArtifact(
      tmpDir,
      'skill_tree.yaml',
      `
library:
  name: '@tanstack/router'
  version: '1.0.0'
skills:
  - name: 'Routing'
    slug: 'routing'
    path: 'packages/router/skills/routing/SKILL.md'
    package: 'packages/router'
`,
    )
    mockFetchNotOk()

    const report = await checkStaleness(
      packageDir,
      '@tanstack/router',
      tmpDir,
    )

    expect(report.signals).toEqual([])
  })
})
