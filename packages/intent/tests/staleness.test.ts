import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

// ---------------------------------------------------------------------------
// Mock fetch for npm registry
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

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

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '2.0.0' }),
    } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skillVersion).toBe('1.2.3')
    expect(report.currentVersion).toBe('2.0.0')
    expect(report.versionDrift).toBe('major')
    expect(report.skills[0]!.needsReview).toBe(true)
    expect(report.skills[0]!.reasons[0]).toContain('version drift')
  })

  it('detects minor version drift', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.4.0' }),
    } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.versionDrift).toBe('minor')
  })

  it('detects patch version drift', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.2.5' }),
    } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.versionDrift).toBe('patch')
  })

  it('reports no drift when versions match', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      library_version: '1.2.3',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.2.3' }),
    } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.versionDrift).toBeNull()
    expect(report.skills[0]!.needsReview).toBe(false)
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

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills[0]!.needsReview).toBe(true)
    expect(report.skills[0]!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('new source')]),
    )
  })

  it('does not flag sources when no sync-state exists', async () => {
    writeSkill(tmpDir, 'core', {
      name: 'core',
      description: 'Core',
      sources: ['docs/api.md'],
    })

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills[0]!.needsReview).toBe(false)
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

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills[0]!.needsReview).toBe(false)
    expect(report.skills[0]!.reasons).toEqual([])
  })

  it('handles nested skill directories', async () => {
    writeSkill(tmpDir, 'react/hooks', {
      name: 'react/hooks',
      description: 'React hooks',
      library_version: '1.0.0',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '2.0.0' }),
    } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills).toHaveLength(1)
    expect(report.skills[0]!.name).toBe('react/hooks')
    expect(report.skills[0]!.needsReview).toBe(true)
  })

  it('uses directory name when frontmatter has no name', async () => {
    writeSkill(tmpDir, 'my-skill', {
      description: 'A skill with no name field',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills[0]!.name).toBe('my-skill')
  })

  it('uses skillVersion from first skill that has library_version', async () => {
    writeSkill(tmpDir, 'a', { name: 'a', description: 'No version' })
    writeSkill(tmpDir, 'b', {
      name: 'b',
      description: 'Has version',
      library_version: '3.5.0',
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '4.0.0' }),
    } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skillVersion).toBe('3.5.0')
    expect(report.versionDrift).toBe('major')
  })

  it('handles malformed SKILL.md without crashing', async () => {
    const skillDir = join(tmpDir, 'skills', 'broken')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), 'no frontmatter here')

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

    const report = await checkStaleness(tmpDir, '@example/lib')
    expect(report.skills).toHaveLength(1)
    expect(report.skills[0]!.needsReview).toBe(false)
  })
})
