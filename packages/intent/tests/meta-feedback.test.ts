import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  metaToMarkdown,
  submitMetaFeedback,
  validateMetaPayload,
} from '../src/feedback.js'
import type { MetaFeedbackPayload } from '../src/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string

function setupDir(): string {
  const dir = join(
    tmpdir(),
    `intent-meta-fb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function validMetaPayload(
  overrides: Partial<MetaFeedbackPayload> = {},
): MetaFeedbackPayload {
  return {
    metaSkill: 'domain-discovery',
    library: '@tanstack/query',
    agentUsed: 'claude-code',
    artifactQuality: 'good',
    whatWorked: 'Interview questions surfaced real failure modes',
    whatFailed: 'Missed some SSR-specific gotchas',
    suggestions: 'Add more framework-specific probing',
    userRating: 'mixed',
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
// validateMetaPayload
// ---------------------------------------------------------------------------

describe('validateMetaPayload', () => {
  it('accepts a valid payload', () => {
    const result = validateMetaPayload(validMetaPayload())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects non-object input', () => {
    const result = validateMetaPayload('not an object')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('JSON object')
  })

  it('rejects null', () => {
    const result = validateMetaPayload(null)
    expect(result.valid).toBe(false)
  })

  it('reports missing required fields', () => {
    const result = validateMetaPayload({ metaSkill: 'domain-discovery' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
    expect(result.errors.some((e) => e.includes('library'))).toBe(true)
  })

  it('rejects empty string fields', () => {
    const result = validateMetaPayload(validMetaPayload({ whatWorked: '' }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('whatWorked'))).toBe(true)
  })

  it('rejects invalid metaSkill', () => {
    const result = validateMetaPayload(
      validMetaPayload({ metaSkill: 'not-a-skill' as any }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('metaSkill'))).toBe(true)
  })

  it('rejects invalid agentUsed', () => {
    const result = validateMetaPayload(
      validMetaPayload({ agentUsed: 'chatgpt' as any }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('agentUsed'))).toBe(true)
  })

  it('rejects invalid userRating', () => {
    const result = validateMetaPayload(
      validMetaPayload({ userRating: 'excellent' as any }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('userRating'))).toBe(true)
  })

  it('rejects payloads containing secrets', () => {
    const result = validateMetaPayload(
      validMetaPayload({
        whatFailed: 'Used token ghp_' + 'A'.repeat(36) + ' and it failed',
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('secrets'))).toBe(true)
  })

  it('accepts optional fields', () => {
    const result = validateMetaPayload(
      validMetaPayload({
        interviewQuality: 'good',
        failureModeQuality: 'mixed',
      }),
    )
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// metaToMarkdown
// ---------------------------------------------------------------------------

describe('metaToMarkdown', () => {
  it('converts payload to markdown', () => {
    const md = metaToMarkdown(validMetaPayload())
    expect(md).toContain('# Meta-Skill Feedback: domain-discovery')
    expect(md).toContain('**Library:** @tanstack/query')
    expect(md).toContain('**Agent:** claude-code')
    expect(md).toContain('**Artifact quality:** good')
    expect(md).toContain('**Rating:** mixed')
    expect(md).toContain('## What Worked')
    expect(md).toContain('## What Failed')
    expect(md).toContain('## Suggestions')
  })

  it('includes optional quality fields when present', () => {
    const md = metaToMarkdown(
      validMetaPayload({
        interviewQuality: 'good',
        failureModeQuality: 'bad',
      }),
    )
    expect(md).toContain('**Interview quality:** good')
    expect(md).toContain('**Failure mode quality:** bad')
  })

  it('omits optional quality fields when not present', () => {
    const md = metaToMarkdown(validMetaPayload())
    expect(md).not.toContain('Interview quality')
    expect(md).not.toContain('Failure mode quality')
  })
})

// ---------------------------------------------------------------------------
// submitMetaFeedback
// ---------------------------------------------------------------------------

describe('submitMetaFeedback', () => {
  it('saves to file when gh not available and outputPath given', () => {
    const outPath = join(tmpDir, 'meta-feedback.md')
    const result = submitMetaFeedback(validMetaPayload(), {
      ghAvailable: false,
      outputPath: outPath,
    })
    expect(result.method).toBe('file')
    expect(result.detail).toContain(outPath)
    expect(existsSync(outPath)).toBe(true)
    const content = readFileSync(outPath, 'utf8')
    expect(content).toContain('# Meta-Skill Feedback')
  })

  it('returns stdout when no gh and no outputPath', () => {
    const result = submitMetaFeedback(validMetaPayload(), {
      ghAvailable: false,
    })
    expect(result.method).toBe('stdout')
    expect(result.detail).toContain('# Meta-Skill Feedback')
  })
})
