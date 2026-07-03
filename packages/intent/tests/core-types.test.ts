import { describe, expect, it } from 'vitest'
import { sourceIdentityEquals, sourceIdentityKey } from '../src/core/types.js'

describe('sourceIdentityKey', () => {
  it('distinguishes npm:foo from workspace:foo', () => {
    expect(sourceIdentityKey({ kind: 'npm', id: 'foo' })).not.toBe(
      sourceIdentityKey({ kind: 'workspace', id: 'foo' }),
    )
  })

  it('is stable for the same kind and id', () => {
    expect(sourceIdentityKey({ kind: 'npm', id: 'foo' })).toBe(
      sourceIdentityKey({ kind: 'npm', id: 'foo' }),
    )
  })
})

describe('sourceIdentityEquals', () => {
  it('returns false when kind differs but id matches', () => {
    expect(
      sourceIdentityEquals(
        { kind: 'npm', id: 'foo' },
        { kind: 'workspace', id: 'foo' },
      ),
    ).toBe(false)
  })

  it('returns false when id differs but kind matches', () => {
    expect(
      sourceIdentityEquals(
        { kind: 'npm', id: 'foo' },
        { kind: 'npm', id: 'bar' },
      ),
    ).toBe(false)
  })

  it('returns true when kind and id both match', () => {
    expect(
      sourceIdentityEquals(
        { kind: 'npm', id: 'foo' },
        { kind: 'npm', id: 'foo' },
      ),
    ).toBe(true)
  })
})
