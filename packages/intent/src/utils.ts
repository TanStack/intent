import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Recursively find all SKILL.md files under a directory.
 */
export function findSkillFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files
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

/**
 * Parse YAML frontmatter from a file. Returns null if no frontmatter or on error.
 */
export function parseFrontmatter(
  filePath: string,
): Record<string, unknown> | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return null
  try {
    return parseYaml(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}
