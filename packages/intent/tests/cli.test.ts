import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

// ── Meta-skills tests (intent meta) ──

const thisDir = dirname(fileURLToPath(import.meta.url))
const metaDir = join(thisDir, '..', 'meta')

describe('intent meta', () => {
  it('meta directory exists', () => {
    expect(existsSync(metaDir)).toBe(true)
  })

  it('contains expected meta-skills', () => {
    const entries = readdirSync(metaDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => existsSync(join(metaDir, e.name, 'SKILL.md')))
      .map((e) => e.name)

    expect(entries).toContain('domain-discovery')
    expect(entries).toContain('tree-generator')
    expect(entries).toContain('generate-skill')
    expect(entries).toContain('skill-staleness-check')
  })

  it('each meta-skill has a description in frontmatter', () => {
    const entries = readdirSync(metaDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => existsSync(join(metaDir, e.name, 'SKILL.md')))

    for (const entry of entries) {
      const content = readFileSync(
        join(metaDir, entry.name, 'SKILL.md'),
        'utf8',
      )
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      expect(match, `${entry.name} should have frontmatter`).not.toBeNull()

      if (!match?.[1]) continue

      const fm = parseYaml(match[1]) as Record<string, unknown>
      expect(
        fm.description,
        `${entry.name} should have a description`,
      ).toBeTruthy()
    }
  })
})

// ── Validate command logic ──

describe('intent validate', () => {
  it('finds SKILL.md files in meta directory', async () => {
    const { findSkillFiles } = await import('../src/utils.js')
    const files = findSkillFiles(metaDir)
    expect(files.length).toBeGreaterThan(0)
  })
})

// ── Scanner JSON output shape ──

describe('intent list --json shape', () => {
  it('scanForIntents returns correct shape', async () => {
    const { scanForIntents } = await import('../src/scanner.js')
    // Run against a dir with no node_modules — should return valid shape
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const root = mkdtempSync(join(tmpdir(), 'cli-test-'))

    const result = scanForIntents(root)
    expect(result).toHaveProperty('packageManager')
    expect(result).toHaveProperty('packages')
    expect(result).toHaveProperty('warnings')
    expect(Array.isArray(result.packages)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)

    // Cleanup
    const { rmSync } = await import('node:fs')
    rmSync(root, { recursive: true, force: true })
  })
})
