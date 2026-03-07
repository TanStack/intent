import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

// ── Types ──

interface SkillFrontmatter {
  name: string
  description: string
  type?: string
  library?: string
  framework?: string
  library_version?: string
  requires?: Array<string>
  sources?: Array<string>
}

// ── Helpers ──

const META_DIR = join(__dirname, '..', 'meta')
const MAX_META_SKILL_LINES = 1000

function findSkillFiles(dir: string): Array<string> {
  const files: Array<string> = []
  if (!existsSync(dir)) return files

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...findSkillFiles(fullPath))
    } else if (entry === 'SKILL.md') {
      files.push(fullPath)
    }
  }
  return files
}

function extractFrontmatter(
  content: string,
): { frontmatter: SkillFrontmatter; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/)
  if (!match || !match[1] || match[2] === undefined) return null

  try {
    const frontmatter = parseYaml(match[1]!) as SkillFrontmatter
    return { frontmatter, body: match[2]! }
  } catch {
    return null
  }
}

function skillPathFromFile(baseDir: string, filePath: string): string {
  return relative(baseDir, filePath)
    .replace(/[/\\]SKILL\.md$/, '')
    .split(sep)
    .join('/')
}

// ── Collect meta-skills ──

const metaSkillFiles = findSkillFiles(META_DIR)
const metaSkills = metaSkillFiles.map((filePath) => {
  const content = readFileSync(filePath, 'utf-8')
  const parsed = extractFrontmatter(content)
  const relPath = skillPathFromFile(META_DIR, filePath)
  return { filePath, content, parsed, relPath }
})

// ── Tests ──

describe('meta-skill discovery', () => {
  it('should find meta-skill files', () => {
    expect(metaSkillFiles.length).toBeGreaterThan(0)
  })

  it('should include domain-discovery', () => {
    expect(
      metaSkills.find((s) => s.relPath === 'domain-discovery'),
    ).toBeDefined()
  })

  it('should include tree-generator', () => {
    expect(metaSkills.find((s) => s.relPath === 'tree-generator')).toBeDefined()
  })

  it('should include generate-skill', () => {
    expect(metaSkills.find((s) => s.relPath === 'generate-skill')).toBeDefined()
  })

  it('should include skill-staleness-check', () => {
    expect(
      metaSkills.find((s) => s.relPath === 'skill-staleness-check'),
    ).toBeDefined()
  })
})

describe('meta-skill frontmatter', () => {
  for (const skill of metaSkills) {
    describe(skill.relPath, () => {
      it('should have valid frontmatter', () => {
        expect(skill.parsed).not.toBeNull()
      })

      if (!skill.parsed) return

      const { frontmatter } = skill.parsed

      it('should have a name', () => {
        expect(frontmatter.name).toBeTruthy()
      })

      it('should have a description', () => {
        expect(frontmatter.description).toBeTruthy()
      })
    })
  }
})

describe('meta-skill content', () => {
  for (const skill of metaSkills) {
    describe(skill.relPath, () => {
      it(`should not exceed ${MAX_META_SKILL_LINES} lines`, () => {
        const lineCount = skill.content.split(/\r?\n/).length
        expect(lineCount).toBeLessThanOrEqual(MAX_META_SKILL_LINES)
      })
    })
  }
})
