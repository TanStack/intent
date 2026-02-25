import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FeedbackPayload, PlaybookProjectConfig } from './types.js'

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,           // GitHub tokens
  /(?:sk|pk)[-_](?:live|test)[-_][A-Za-z0-9]{24,}/,       // Stripe keys
  /AKIA[0-9A-Z]{16}/,                                      // AWS access keys
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,               // PEM private keys
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,           // JWT-like tokens
  /(?:Bearer|token)\s+[A-Za-z0-9_\-.~+/]{20,}/i,          // Bearer tokens
  /[A-Za-z0-9]{32,}(?=.*(?:key|secret|token|password))/i,  // Generic secrets near keywords
]

export function containsSecrets(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

// ---------------------------------------------------------------------------
// `gh` CLI detection
// ---------------------------------------------------------------------------

export function hasGhCli(): boolean {
  try {
    execSync('gh --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function getHomeConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config')
}

export function resolveFrequency(root: string): string {
  // 1. User override (~/.config/playbook/config.json)
  const userConfigPath = join(getHomeConfigDir(), 'playbook', 'config.json')
  try {
    const userCfg = JSON.parse(readFileSync(userConfigPath, 'utf8')) as Partial<PlaybookProjectConfig>
    if (userCfg.feedback?.frequency) return userCfg.feedback.frequency
  } catch { /* fallback */ }

  // 2. Project config
  const projectConfigPath = join(root, 'playbook.config.json')
  try {
    const projCfg = JSON.parse(readFileSync(projectConfigPath, 'utf8')) as Partial<PlaybookProjectConfig>
    if (projCfg.feedback?.frequency) return projCfg.feedback.frequency
  } catch { /* fallback */ }

  // 3. Default
  return 'every-5'
}

// ---------------------------------------------------------------------------
// Feedback payload validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: (keyof FeedbackPayload)[] = [
  'skill', 'package', 'skillVersion', 'task',
  'whatWorked', 'whatFailed', 'missing',
  'selfCorrections', 'userRating',
]

export function validatePayload(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] }
  }
  const obj = payload as Record<string, unknown>

  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      errors.push(`Missing or empty required field: ${field}`)
    }
  }

  if (obj.userRating && !['good', 'mixed', 'bad'].includes(obj.userRating as string)) {
    errors.push('userRating must be one of: good, mixed, bad')
  }

  // Secret scan across all string values
  const allText = Object.values(obj)
    .filter((v) => typeof v === 'string')
    .join('\n')

  if (containsSecrets(allText)) {
    errors.push('Payload appears to contain secrets or tokens — submission rejected')
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Markdown conversion
// ---------------------------------------------------------------------------

export function toMarkdown(payload: FeedbackPayload): string {
  const lines = [
    `# Skill Feedback: ${payload.skill}`,
    '',
    `**Package:** ${payload.package}`,
    `**Skill version:** ${payload.skillVersion}`,
    `**Rating:** ${payload.userRating}`,
    '',
    '## Task',
    payload.task,
    '',
    '## What Worked',
    payload.whatWorked,
    '',
    '## What Failed',
    payload.whatFailed,
    '',
    '## Missing',
    payload.missing,
    '',
    '## Self-Corrections',
    payload.selfCorrections,
  ]

  if (payload.userComments) {
    lines.push('', '## User Comments', payload.userComments)
  }

  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitResult {
  method: 'gh' | 'file' | 'stdout'
  detail: string
}

export function submitFeedback(
  payload: FeedbackPayload,
  repo: string,
  opts: { ghAvailable: boolean; outputPath?: string },
): SubmitResult {
  const md = toMarkdown(payload)

  // Try gh
  if (opts.ghAvailable) {
    try {
      const title = `Skill Feedback: ${payload.skill} (${payload.userRating})`
      execSync(
        `gh issue create --repo ${repo} --title "${title.replace(/"/g, '\\"')}" --body -`,
        { input: md, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      return { method: 'gh', detail: `Submitted issue to ${repo}` }
    } catch {
      // Fall through to file
    }
  }

  // File fallback
  if (opts.outputPath) {
    writeFileSync(opts.outputPath, md, 'utf8')
    return { method: 'file', detail: `Saved to ${opts.outputPath}` }
  }

  // Stdout fallback
  return { method: 'stdout', detail: md }
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

export function runFeedback(args: string[]): void {
  const submitFlag = args.includes('--submit')
  const fileIdx = args.indexOf('--file')
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : undefined

  if (!submitFlag || !filePath) {
    console.error('Usage: playbook feedback --submit --file <path>')
    process.exit(1)
  }

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    console.error('Invalid JSON in feedback file')
    process.exit(1)
  }

  const validation = validatePayload(raw)
  if (!validation.valid) {
    console.error('Feedback validation failed:')
    for (const err of validation.errors) console.error(`  - ${err}`)
    process.exit(1)
  }

  const payload = raw as FeedbackPayload

  // We need a repo to submit to — use package field as a fallback identifier
  const repo = payload.package.replace(/^@/, '').replace(/\//, '/')

  const ghAvailable = hasGhCli()
  const frequency = resolveFrequency(process.cwd())

  if (frequency === 'never') {
    console.log('Feedback is disabled (frequency: never)')
    return
  }

  const dateSuffix = new Date().toISOString().slice(0, 10)
  const fallbackPath = `playbook-feedback-${dateSuffix}.md`

  const result = submitFeedback(payload, repo, {
    ghAvailable,
    outputPath: ghAvailable ? undefined : fallbackPath,
  })

  switch (result.method) {
    case 'gh':
      console.log(`✓ ${result.detail}`)
      break
    case 'file':
      console.log(`✓ ${result.detail}`)
      console.log('You can manually open an issue with this content.')
      break
    case 'stdout':
      console.log('--- Feedback markdown (copy/paste to issue) ---')
      console.log(result.detail)
      break
  }
}
