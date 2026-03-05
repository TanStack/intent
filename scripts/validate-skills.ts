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

const skillsArg = process.argv[2]
const SKILLS_DIR = skillsArg
  ? join(process.cwd(), skillsArg)
  : join(process.cwd(), 'skills')
const MAX_LINES = 500

const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /(?:npm|yarn|pnpm|bun)\s+(?:install|add|i)\s/i,
    description: 'Install instructions',
  },
  {
    pattern: /(?:curl|wget|fetch)\s+https?:\/\//i,
    description: 'Instructions to fetch external URLs at runtime',
  },
]

const ALLOWED_SHELL_COMMANDS = [
  'intent list',
  'intent feedback',
  'npm install @tanstack/',
  'npx intent',
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
  if (!match?.[1]) return null

  try {
    const frontmatter = parseYaml(match[1]) as SkillFrontmatter
    return { frontmatter, body: match[2] ?? '' }
  } catch {
    return null
  }
}

function skillPathFromFile(filePath: string): string {
  const rel = relative(SKILLS_DIR, filePath)
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

  if (frontmatter.name) {
    const expectedPath = skillPathFromFile(filePath)
    if (frontmatter.name !== expectedPath) {
      errors.push({
        file: rel,
        message: `name "${frontmatter.name}" does not match directory path "${expectedPath}"`,
      })
    }
  }

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

  const lineCount = content.split(/\r?\n/).length
  if (lineCount > MAX_LINES) {
    errors.push({
      file: rel,
      message: `Exceeds ${MAX_LINES} line limit (${lineCount} lines)`,
    })
  }

  for (const { pattern, description } of PROHIBITED_PATTERNS) {
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

// ── Main ──

function main(): void {
  const errors: Array<ValidationError> = []

  console.log(`Validating skills in: ${SKILLS_DIR}`)

  const skillFiles = findSkillFiles(SKILLS_DIR)

  if (skillFiles.length === 0) {
    console.log('No SKILL.md files found — nothing to validate')
    process.exit(0)
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
