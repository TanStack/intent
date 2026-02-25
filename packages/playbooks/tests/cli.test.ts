import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

// ── Meta-skills tests (playbook meta) ──

const thisDir = dirname(fileURLToPath(import.meta.url))
const metaDir = join(thisDir, '..', 'meta')

describe('playbook meta', () => {
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
      const content = readFileSync(join(metaDir, entry.name, 'SKILL.md'), 'utf8')
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      expect(match, `${entry.name} should have frontmatter`).not.toBeNull()

      const fm = parseYaml(match![1]) as Record<string, unknown>
      expect(fm.description, `${entry.name} should have a description`).toBeTruthy()
    }
  })
})

// ── Validate command logic ──

describe('playbook validate', () => {
  it('finds SKILL.md files in meta directory', () => {
    function findSkillFiles(dir: string): string[] {
      const files: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...findSkillFiles(fullPath))
        } else if (entry.name === 'SKILL.md') {
          files.push(fullPath)
        }
      }
      return files
    }

    const files = findSkillFiles(metaDir)
    expect(files.length).toBeGreaterThan(0)
  })
})

// ── Scanner JSON output shape ──

describe('playbook list --json shape', () => {
  it('scanForPlaybooks returns correct shape', async () => {
    const { scanForPlaybooks } = await import('../src/scanner.js')
    // Run against a dir with no node_modules — should return valid shape
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const root = mkdtempSync(join(tmpdir(), 'cli-test-'))

    const result = await scanForPlaybooks(root)
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
