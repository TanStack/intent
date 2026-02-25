import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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

interface ValidationError {
  file: string
  message: string
}

// ── Constants ──

const SKILLS_DIR = join(process.cwd(), 'packages', 'playbooks', 'skills')
const PACKAGE_MAP_PATH = join(
  process.cwd(),
  'packages',
  'playbooks',
  'package_map.yaml',
)
const MAX_LINES = 500

const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern:
      /(?:npm|yarn|pnpm|bun)\s+(?:install|add|i)\s/i,
    description: 'Install instructions',
  },
  {
    pattern: /(?:curl|wget|fetch)\s+https?:\/\//i,
    description: 'Instructions to fetch external URLs at runtime',
  },
]

const ALLOWED_SHELL_COMMANDS = [
  'tanstack playbook list',
  'tanstack playbook feedback',
  'npm install @tanstack/',
]

// ── Helpers ──

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
  const rel = relative(SKILLS_DIR, filePath)
  // Remove trailing /SKILL.md and convert separators to /
  return rel
    .replace(/[/\\]SKILL\.md$/, '')
    .split(sep)
    .join('/')
}

// ── Validators ──

function validateFrontmatter(
  filePath: string,
  frontmatter: SkillFrontmatter,
): Array<ValidationError> {
  const errors: Array<ValidationError> = []
  const rel = relative(process.cwd(), filePath)

  if (!frontmatter.name) {
    errors.push({ file: rel, message: 'Missing required field: name' })
  }

  if (!frontmatter.description) {
    errors.push({ file: rel, message: 'Missing required field: description' })
  }

  // Validate name matches directory path
  if (frontmatter.name) {
    const expectedPath = skillPathFromFile(filePath)
    if (frontmatter.name !== expectedPath) {
      errors.push({
        file: rel,
        message: `name "${frontmatter.name}" does not match directory path "${expectedPath}"`,
      })
    }
  }

  // Framework skills must have requires
  if (frontmatter.type === 'framework' && !frontmatter.requires?.length) {
    errors.push({
      file: rel,
      message: 'Framework skills must have a "requires" field',
    })
  }

  return errors
}

function validateContent(
  filePath: string,
  content: string,
  body: string,
): Array<ValidationError> {
  const errors: Array<ValidationError> = []
  const rel = relative(process.cwd(), filePath)

  // Line count
  const lineCount = content.split(/\r?\n/).length
  if (lineCount > MAX_LINES) {
    errors.push({
      file: rel,
      message: `Exceeds ${MAX_LINES} line limit (${lineCount} lines)`,
    })
  }

  // Prohibited content
  for (const { pattern, description } of PROHIBITED_PATTERNS) {
    // Check each line to allow framework setup instructions (npm install @tanstack/...)
    for (const line of body.split(/\r?\n/)) {
      if (pattern.test(line)) {
        const isAllowed = ALLOWED_SHELL_COMMANDS.some((cmd) =>
          line.includes(cmd),
        )
        if (!isAllowed) {
          errors.push({
            file: rel,
            message: `Prohibited content: ${description} — "${line.trim().slice(0, 80)}"`,
          })
          break
        }
      }
    }
  }

  return errors
}

function validatePackageMap(): Array<ValidationError> {
  const errors: Array<ValidationError> = []
  const rel = relative(process.cwd(), PACKAGE_MAP_PATH)

  if (!existsSync(PACKAGE_MAP_PATH)) {
    errors.push({ file: rel, message: 'package_map.yaml not found' })
    return errors
  }

  try {
    const content = readFileSync(PACKAGE_MAP_PATH, 'utf-8')
    const map = parseYaml(content) as Record<string, unknown>

    if (!map.schema_version) {
      errors.push({ file: rel, message: 'Missing schema_version' })
    }

    if (!map.package_map || typeof map.package_map !== 'object') {
      errors.push({ file: rel, message: 'Missing or invalid package_map' })
    }

    if (!map.always_include || !Array.isArray(map.always_include)) {
      errors.push({
        file: rel,
        message: 'Missing or invalid always_include',
      })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errors.push({ file: rel, message: `Invalid YAML: ${message}` })
  }

  return errors
}

// ── Main ──

function main(): void {
  const errors: Array<ValidationError> = []

  // Validate package_map.yaml
  errors.push(...validatePackageMap())

  // Find and validate all SKILL.md files
  const skillFiles = findSkillFiles(SKILLS_DIR)

  if (skillFiles.length === 0) {
    console.error('No SKILL.md files found')
    process.exit(1)
  }

  for (const filePath of skillFiles) {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = extractFrontmatter(content)

    const rel = relative(process.cwd(), filePath)

    if (!parsed) {
      errors.push({ file: rel, message: 'Missing or invalid frontmatter' })
      continue
    }

    errors.push(...validateFrontmatter(filePath, parsed.frontmatter))
    errors.push(...validateContent(filePath, content, parsed.body))
  }

  // Report
  if (errors.length > 0) {
    console.error(`\n❌ Validation failed with ${errors.length} error(s):\n`)
    for (const { file, message } of errors) {
      console.error(`  ${file}: ${message}`)
    }
    console.error('')
    process.exit(1)
  }

  console.log(`✅ Validated ${skillFiles.length} skill files — all passed`)
}

main()
