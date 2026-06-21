import { describe, expect, it } from 'vitest'
import { readScalarField } from '../src/shared/utils.js'

describe('readScalarField', () => {
  it('reads a top-level scalar (old shape)', () => {
    expect(readScalarField({ type: 'core' }, 'type')).toBe('core')
  })

  it('reads a scalar nested under metadata (new shape)', () => {
    expect(readScalarField({ metadata: { type: 'core' } }, 'type')).toBe('core')
  })

  it('prefers metadata over a top-level value when both are present', () => {
    expect(
      readScalarField({ type: 'top', metadata: { type: 'nested' } }, 'type'),
    ).toBe('nested')
  })

  it('falls back to top-level when metadata exists but lacks the key (partial migration)', () => {
    expect(
      readScalarField(
        { type: 'top', metadata: { framework: 'react' } },
        'type',
      ),
    ).toBe('top')
  })

  it('falls back to top-level when the metadata value is not a string', () => {
    expect(
      readScalarField({ type: 'top', metadata: { type: 123 } }, 'type'),
    ).toBe('top')
  })

  it('ignores a metadata array and uses the top-level value', () => {
    expect(readScalarField({ type: 'top', metadata: ['type'] }, 'type')).toBe(
      'top',
    )
  })

  it('ignores a metadata string and uses the top-level value', () => {
    expect(readScalarField({ type: 'top', metadata: 'nope' }, 'type')).toBe(
      'top',
    )
  })

  it('returns undefined when the key is absent in both shapes', () => {
    expect(readScalarField({ name: 'x' }, 'type')).toBeUndefined()
  })

  it('returns undefined when a non-string top-level value has no metadata fallback', () => {
    expect(readScalarField({ type: 123 }, 'type')).toBeUndefined()
  })

  it('returns undefined for null frontmatter', () => {
    expect(readScalarField(null, 'type')).toBeUndefined()
  })

  it('returns an empty-string metadata value as-is', () => {
    expect(readScalarField({ metadata: { type: '' } }, 'type')).toBe('')
  })
})
