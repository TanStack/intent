import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  FeedbackPayload,
  IntentProjectConfig,
  MetaFeedbackPayload,
} from './types.js'

const META_FEEDBACK_REPO = 'TanStack/intent'

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/, // GitHub tokens
  /(?:sk|pk)[-_](?:live|test)[-_][A-Za-z0-9]{24,}/, // Stripe keys
  /AKIA[0-9A-Z]{16}/, // AWS access keys
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, // PEM private keys
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT-like tokens
  /(?:Bearer|token)\s+[A-Za-z0-9_\-.~+/]{20,}/i, // Bearer tokens
  /[A-Za-z0-9]{32,}(?=.*(?:key|secret|token|password))/i, // Generic secrets near keywords
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
  return (
    process.env.XDG_CONFIG_HOME ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config')
  )
}

export function resolveFrequency(root: string): string {
  // 1. User override (~/.config/intent/config.json)
  const userConfigPath = join(getHomeConfigDir(), 'intent', 'config.json')
  try {
    const userCfg = JSON.parse(
      readFileSync(userConfigPath, 'utf8'),
    ) as Partial<IntentProjectConfig>
    if (userCfg.feedback?.frequency) return userCfg.feedback.frequency
  } catch {
    /* fallback */
  }

  // 2. Project config
  const projectConfigPath = join(root, 'intent.config.json')
  try {
    const projCfg = JSON.parse(
      readFileSync(projectConfigPath, 'utf8'),
    ) as Partial<IntentProjectConfig>
    if (projCfg.feedback?.frequency) return projCfg.feedback.frequency
  } catch {
    /* fallback */
  }

  // 3. Default
  return 'every-5'
}

// ---------------------------------------------------------------------------
// Feedback payload validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Array<keyof FeedbackPayload> = [
  'skill',
  'package',
  'skillVersion',
  'task',
  'whatWorked',
  'whatFailed',
  'missing',
  'selfCorrections',
  'userRating',
]

export function validatePayload(payload: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] }
  }
  const obj = payload as Record<string, unknown>

  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || obj[field].trim() === '') {
      errors.push(`Missing or empty required field: ${field}`)
    }
  }

  if (
    obj.userRating &&
    !['good', 'mixed', 'bad'].includes(obj.userRating as string)
  ) {
    errors.push('userRating must be one of: good, mixed, bad')
  }

  // Secret scan across all string values
  const allText = Object.values(obj)
    .filter((v) => typeof v === 'string')
    .join('\n')

  if (containsSecrets(allText)) {
    errors.push(
      'Payload appears to contain secrets or tokens — submission rejected',
    )
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Meta-feedback payload validation
// ---------------------------------------------------------------------------

const META_REQUIRED_FIELDS: Array<keyof MetaFeedbackPayload> = [
  'metaSkill',
  'library',
  'agentUsed',
  'artifactQuality',
  'whatWorked',
  'whatFailed',
  'suggestions',
  'userRating',
]

const VALID_META_SKILLS = [
  'domain-discovery',
  'tree-generator',
  'generate-skill',
  'skill-staleness-check',
]

const VALID_AGENTS = ['claude-code', 'cursor', 'copilot', 'codex', 'other']

const VALID_QUALITY_RATINGS = ['good', 'mixed', 'bad']

export function validateMetaPayload(payload: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] }
  }
  const obj = payload as Record<string, unknown>

  for (const field of META_REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || obj[field].trim() === '') {
      errors.push(`Missing or empty required field: ${field}`)
    }
  }

  if (obj.metaSkill && !VALID_META_SKILLS.includes(obj.metaSkill as string)) {
    errors.push(`metaSkill must be one of: ${VALID_META_SKILLS.join(', ')}`)
  }

  if (obj.agentUsed && !VALID_AGENTS.includes(obj.agentUsed as string)) {
    errors.push(`agentUsed must be one of: ${VALID_AGENTS.join(', ')}`)
  }

  if (
    obj.artifactQuality &&
    !VALID_QUALITY_RATINGS.includes(obj.artifactQuality as string)
  ) {
    errors.push('artifactQuality must be one of: good, mixed, bad')
  }

  if (
    obj.userRating &&
    !VALID_QUALITY_RATINGS.includes(obj.userRating as string)
  ) {
    errors.push('userRating must be one of: good, mixed, bad')
  }

  // Secret scan
  const allText = Object.values(obj)
    .filter((v) => typeof v === 'string')
    .join('\n')

  if (containsSecrets(allText)) {
    errors.push(
      'Payload appears to contain secrets or tokens — submission rejected',
    )
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Markdown conversion
// ---------------------------------------------------------------------------

export function metaToMarkdown(payload: MetaFeedbackPayload): string {
  const lines = [
    `# Meta-Skill Feedback: ${payload.metaSkill}`,
    '',
    `**Library:** ${payload.library}`,
    `**Agent:** ${payload.agentUsed}`,
    `**Artifact quality:** ${payload.artifactQuality}`,
    `**Rating:** ${payload.userRating}`,
  ]

  if (payload.interviewQuality) {
    lines.push(`**Interview quality:** ${payload.interviewQuality}`)
  }
  if (payload.failureModeQuality) {
    lines.push(`**Failure mode quality:** ${payload.failureModeQuality}`)
  }

  lines.push(
    '',
    '## What Worked',
    payload.whatWorked,
    '',
    '## What Failed',
    payload.whatFailed,
    '',
    '## Suggestions',
    payload.suggestions,
  )

  return lines.join('\n') + '\n'
}

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
      execFileSync(
        'gh',
        ['issue', 'create', '--repo', repo, '--title', title, '--body', '-'],
        { input: md, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      return { method: 'gh', detail: `Submitted issue to ${repo}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`GitHub submission failed: ${msg}`)
      console.error('Falling back to file output.')
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
// Meta-feedback submission
// ---------------------------------------------------------------------------

export function submitMetaFeedback(
  payload: MetaFeedbackPayload,
  opts: { ghAvailable: boolean; outputPath?: string },
): SubmitResult {
  const md = metaToMarkdown(payload)

  if (opts.ghAvailable) {
    try {
      const title = `Meta-Skill Feedback: ${payload.metaSkill} (${payload.userRating})`
      execFileSync(
        'gh',
        [
          'issue',
          'create',
          '--repo',
          META_FEEDBACK_REPO,
          '--title',
          title,
          '--label',
          `skill:${payload.metaSkill}`,
          '--body',
          '-',
        ],
        { input: md, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      return {
        method: 'gh',
        detail: `Submitted issue to ${META_FEEDBACK_REPO}`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`GitHub submission failed: ${msg}`)
      console.error('Falling back to file output.')
    }
  }

  if (opts.outputPath) {
    writeFileSync(opts.outputPath, md, 'utf8')
    return { method: 'file', detail: `Saved to ${opts.outputPath}` }
  }

  return { method: 'stdout', detail: md }
}
