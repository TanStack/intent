import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  containsSecrets,
  resolveFrequency,
  submitFeedback,
  toMarkdown,
  validatePayload,
} from '../src/feedback.js'
import type { FeedbackPayload } from '../src/types.js'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string

function setupDir(): string {
  const dir = join(
    tmpdir(),
    `intent-fb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function validPayload(
  overrides: Partial<FeedbackPayload> = {},
): FeedbackPayload {
  return {
    skill: 'db-core/live-queries',
    package: '@tanstack/db',
    skillVersion: '0.5.0',
    task: 'Set up a live query subscription',
    whatWorked: 'Query builder syntax was great',
    whatFailed: 'Collection creation missed an import',
    missing: 'No examples for nested joins',
    selfCorrections: 'Had to add missing import manually',
    userRating: 'good',
    ...overrides,
  }
}

beforeEach(() => {
  tmpDir = setupDir()
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// containsSecrets
// ---------------------------------------------------------------------------

describe('containsSecrets', () => {
  it('detects GitHub tokens', () => {
    expect(containsSecrets('token: ghp_' + 'A'.repeat(36))).toBe(true)
  })

  it('detects AWS access keys', () => {
    expect(containsSecrets('key: AKIA' + '0'.repeat(16))).toBe(true)
  })

  it('detects PEM private keys', () => {
    expect(containsSecrets('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
  })

  it('detects Stripe keys', () => {
    expect(containsSecrets('sk-live-' + 'a'.repeat(24))).toBe(true)
  })

  it('detects Bearer tokens', () => {
    expect(containsSecrets('Bearer ' + 'a'.repeat(30))).toBe(true)
  })

  it('does not flag normal text', () => {
    expect(
      containsSecrets(
        'This is a perfectly normal feedback message about queries.',
      ),
    ).toBe(false)
  })

  it('does not flag short strings', () => {
    expect(containsSecrets('key=abc123')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validatePayload
// ---------------------------------------------------------------------------

describe('validatePayload', () => {
  it('accepts a valid payload', () => {
    const result = validatePayload(validPayload())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects non-object input', () => {
    const result = validatePayload('not an object')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('JSON object')
  })

  it('rejects null', () => {
    const result = validatePayload(null)
    expect(result.valid).toBe(false)
  })

  it('reports missing required fields', () => {
    const result = validatePayload({ skill: 'test' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
    expect(result.errors.some((e) => e.includes('package'))).toBe(true)
  })

  it('rejects empty string fields', () => {
    const result = validatePayload(validPayload({ task: '' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('task'))).toBe(true)
  })

  it('rejects invalid userRating', () => {
    const result = validatePayload(
      validPayload({ userRating: 'excellent' as 'good' }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('userRating'))).toBe(true)
  })

  it('rejects payloads containing secrets', () => {
    const result = validatePayload(
      validPayload({
        whatFailed: 'Used token ghp_' + 'A'.repeat(36) + ' and it failed',
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('secrets'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------

describe('toMarkdown', () => {
  it('converts payload to markdown', () => {
    const md = toMarkdown(validPayload())
    expect(md).toContain('# Skill Feedback: db-core/live-queries')
    expect(md).toContain('**Package:** @tanstack/db')
    expect(md).toContain('**Rating:** good')
    expect(md).toContain('## Task')
    expect(md).toContain('## What Worked')
    expect(md).toContain('## What Failed')
    expect(md).toContain('## Missing')
    expect(md).toContain('## Self-Corrections')
  })

  it('includes user comments when present', () => {
    const md = toMarkdown(validPayload({ userComments: 'Great overall!' }))
    expect(md).toContain('## User Comments')
    expect(md).toContain('Great overall!')
  })

  it('omits user comments section when not present', () => {
    const md = toMarkdown(validPayload())
    expect(md).not.toContain('## User Comments')
  })
})

// ---------------------------------------------------------------------------
// submitFeedback
// ---------------------------------------------------------------------------

describe('submitFeedback', () => {
  it('saves to file when gh not available and outputPath given', () => {
    const outPath = join(tmpDir, 'feedback.md')
    const result = submitFeedback(validPayload(), 'tanstack/db', {
      ghAvailable: false,
      outputPath: outPath,
    })
    expect(result.method).toBe('file')
    expect(result.detail).toContain(outPath)
    expect(existsSync(outPath)).toBe(true)
    const content = readFileSync(outPath, 'utf8')
    expect(content).toContain('# Skill Feedback')
  })

  it('returns stdout when no gh and no outputPath', () => {
    const result = submitFeedback(validPayload(), 'tanstack/db', {
      ghAvailable: false,
    })
    expect(result.method).toBe('stdout')
    expect(result.detail).toContain('# Skill Feedback')
  })
})

// ---------------------------------------------------------------------------
// resolveFrequency
// ---------------------------------------------------------------------------

describe('resolveFrequency', () => {
  it('returns project config frequency when set', () => {
    writeFileSync(
      join(tmpDir, 'intent.config.json'),
      JSON.stringify({ feedback: { frequency: 'always' } }),
    )
    expect(resolveFrequency(tmpDir)).toBe('always')
  })

  it('returns default when no config exists', () => {
    expect(resolveFrequency(tmpDir)).toBe('every-5')
  })

  it('reads user override via XDG_CONFIG_HOME', () => {
    const configDir = join(tmpDir, 'xdg')
    mkdirSync(join(configDir, 'intent'), { recursive: true })
    writeFileSync(
      join(configDir, 'intent', 'config.json'),
      JSON.stringify({ feedback: { frequency: 'never' } }),
    )

    const originalXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = configDir
    try {
      expect(resolveFrequency(tmpDir)).toBe('never')
    } finally {
      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg
      } else {
        delete process.env.XDG_CONFIG_HOME
      }
    }
  })

  it('user override takes precedence over project config', () => {
    // Project says "always"
    writeFileSync(
      join(tmpDir, 'intent.config.json'),
      JSON.stringify({ feedback: { frequency: 'always' } }),
    )

    // User override says "never"
    const configDir = join(tmpDir, 'xdg2')
    mkdirSync(join(configDir, 'intent'), { recursive: true })
    writeFileSync(
      join(configDir, 'intent', 'config.json'),
      JSON.stringify({ feedback: { frequency: 'never' } }),
    )

    const originalXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = configDir
    try {
      expect(resolveFrequency(tmpDir)).toBe('never')
    } finally {
      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg
      } else {
        delete process.env.XDG_CONFIG_HOME
      }
    }
  })
})
