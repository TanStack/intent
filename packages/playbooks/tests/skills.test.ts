import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
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

interface PackageMap {
  schema_version: number
  playbook: { name: string; version: string }
  package_map: Record<string, Array<string>>
  compositions?: Array<{ requires: Array<string>; skills: Array<string> }>
  always_include: Array<string>
  feedback: { enabled: boolean; target: string; repo: string; category: string }
}

// ── Helpers ──

const SKILLS_DIR = join(__dirname, '..', 'skills')
const PACKAGE_MAP_PATH = join(__dirname, '..', 'package_map.yaml')
const MAX_LINES = 500

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
  if (!match) return null

  try {
    const frontmatter = parseYaml(match[1]) as SkillFrontmatter
    return { frontmatter, body: match[2] }
  } catch {
    return null
  }
}

function skillPathFromFile(filePath: string): string {
  return relative(SKILLS_DIR, filePath)
    .replace(/[/\\]SKILL\.md$/, '')
    .split(sep)
    .join('/')
}

// ── Collect all skills ──

const skillFiles = findSkillFiles(SKILLS_DIR)
const skills = skillFiles.map((filePath) => {
  const content = readFileSync(filePath, 'utf-8')
  const parsed = extractFrontmatter(content)
  const relPath = skillPathFromFile(filePath)
  return { filePath, content, parsed, relPath }
})

// ── Tests ──

describe('skill discovery', () => {
  it('should find at least one SKILL.md file', () => {
    expect(skillFiles.length).toBeGreaterThan(0)
  })

  it('should include the ecosystem router (tanstack)', () => {
    const router = skills.find((s) => s.relPath === 'tanstack')
    expect(router).toBeDefined()
  })
})

describe('frontmatter', () => {
  for (const skill of skills) {
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

      it('should have name matching directory path', () => {
        expect(frontmatter.name).toBe(skill.relPath)
      })

      if (frontmatter.type === 'framework') {
        it('should have requires field (framework skill)', () => {
          expect(frontmatter.requires).toBeDefined()
          expect(frontmatter.requires!.length).toBeGreaterThan(0)
        })

        it('should have framework field', () => {
          expect(frontmatter.framework).toBeTruthy()
        })
      }

      if (frontmatter.type === 'sub-skill') {
        it('should have library field', () => {
          expect(frontmatter.library).toBeTruthy()
        })

        it('should have library_version field', () => {
          expect(frontmatter.library_version).toBeTruthy()
        })
      }
    })
  }
})

describe('content', () => {
  for (const skill of skills) {
    describe(skill.relPath, () => {
      it(`should not exceed ${MAX_LINES} lines`, () => {
        const lineCount = skill.content.split(/\r?\n/).length
        expect(lineCount).toBeLessThanOrEqual(MAX_LINES)
      })

      if (!skill.parsed) return

      it('should not contain install instructions (except @tanstack packages)', () => {
        const installPattern = /(?:npm|yarn|pnpm|bun)\s+(?:install|add|i)\s/i
        const lines = skill.parsed.body.split(/\r?\n/)

        for (const line of lines) {
          if (installPattern.test(line)) {
            const isAllowed =
              line.includes('npm install @tanstack/') ||
              line.includes('tanstack playbook')
            expect(isAllowed).toBe(true)
          }
        }
      })

      it('should not instruct agents to fetch external URLs at runtime', () => {
        const fetchPattern = /(?:curl|wget)\s+https?:\/\//i
        const lines = skill.parsed.body.split(/\r?\n/)

        for (const line of lines) {
          expect(fetchPattern.test(line)).toBe(false)
        }
      })
    })
  }
})

describe('cross-references', () => {
  const allSkillPaths = new Set(skills.map((s) => s.relPath))

  for (const skill of skills) {
    if (!skill.parsed?.frontmatter.requires) continue

    describe(skill.relPath, () => {
      for (const req of skill.parsed!.frontmatter.requires!) {
        it(`requires "${req}" should reference an existing skill`, () => {
          expect(allSkillPaths.has(req)).toBe(true)
        })
      }
    })
  }
})

describe('package_map.yaml', () => {
  it('should exist', () => {
    expect(existsSync(PACKAGE_MAP_PATH)).toBe(true)
  })

  const content = readFileSync(PACKAGE_MAP_PATH, 'utf-8')
  let packageMap: PackageMap

  it('should be valid YAML', () => {
    packageMap = parseYaml(content) as PackageMap
    expect(packageMap).toBeDefined()
  })

  it('should have schema_version', () => {
    packageMap = parseYaml(content) as PackageMap
    expect(packageMap.schema_version).toBeDefined()
  })

  it('should have package_map', () => {
    packageMap = parseYaml(content) as PackageMap
    expect(packageMap.package_map).toBeDefined()
    expect(typeof packageMap.package_map).toBe('object')
  })

  it('should have always_include', () => {
    packageMap = parseYaml(content) as PackageMap
    expect(packageMap.always_include).toBeDefined()
    expect(Array.isArray(packageMap.always_include)).toBe(true)
  })

  it('should have feedback config', () => {
    packageMap = parseYaml(content) as PackageMap
    expect(packageMap.feedback).toBeDefined()
    expect(packageMap.feedback.repo).toBe('tanstack/playbooks')
  })

  describe('skill directory references', () => {
    packageMap = parseYaml(content) as PackageMap
    const allSkillPaths = new Set(skills.map((s) => s.relPath))

    // Collect all skill dirs referenced in package_map
    const referencedDirs = new Set<string>()
    for (const dirs of Object.values(packageMap.package_map)) {
      for (const dir of dirs) {
        referencedDirs.add(dir)
      }
    }
    for (const dir of packageMap.always_include) {
      referencedDirs.add(dir)
    }

    for (const dir of referencedDirs) {
      it(`"${dir}" should have a corresponding SKILL.md`, () => {
        expect(allSkillPaths.has(dir)).toBe(true)
      })
    }
  })
})
