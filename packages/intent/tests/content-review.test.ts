import { describe, expect, it } from 'vitest'
import { assertSourceContentReviewsMatch } from '../src/core/lockfile/content-review.js'
import type { SourceContentReview } from '../src/core/lockfile/content-review.js'
import type { IntentLockfileSource } from '../src/core/lockfile/lockfile.js'

function review(contentHash: string): SourceContentReview {
  return {
    id: 'foo',
    kind: 'npm',
    version: '1.0.0',
    files: [],
    contentHash,
  }
}

function source(contentHash: string): IntentLockfileSource {
  return {
    id: 'foo',
    kind: 'npm',
    version: '1.0.0',
    resolution: 'npm:foo@1.0.0',
    skills: [],
    contentHash,
    manifestHash: null,
    capabilities: null,
  }
}

describe('assertSourceContentReviewsMatch', () => {
  it('accepts reviewed bytes matching the lock candidate hash', () => {
    expect(() =>
      assertSourceContentReviewsMatch(
        [review('sha256-current')],
        [source('sha256-current')],
      ),
    ).not.toThrow()
  })

  it('rejects content changed between hashing and review', () => {
    expect(() =>
      assertSourceContentReviewsMatch(
        [review('sha256-review')],
        [source('sha256-current')],
      ),
    ).toThrow('changed while it was being reviewed')
  })
})
