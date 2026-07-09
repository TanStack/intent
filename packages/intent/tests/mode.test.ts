import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFrozenMode } from '../src/shared/mode.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isFrozenMode', () => {
  it('is not frozen by default with no signals', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: true })).toBe(false)
  })

  it('is frozen when --frozen is passed', () => {
    vi.stubEnv('CI', undefined)

    expect(isFrozenMode({ frozen: true }, { isTTY: true })).toBe(true)
  })

  it('is frozen when INTENT_FROZEN=1', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', '1')

    expect(isFrozenMode({}, { isTTY: true })).toBe(true)
  })

  it('is frozen when INTENT_FROZEN=true', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', 'true')

    expect(isFrozenMode({}, { isTTY: true })).toBe(true)
  })

  it('treats INTENT_FROZEN=0 as unset', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', '0')

    expect(isFrozenMode({}, { isTTY: true })).toBe(false)
  })

  it('treats INTENT_FROZEN=false as unset', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', 'false')

    expect(isFrozenMode({}, { isTTY: true })).toBe(false)
  })

  it('auto-detects frozen mode when CI=true and stdin is not a TTY', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: undefined })).toBe(true)
  })

  it('auto-detects using the same truthy set for CI (e.g. CI=1)', () => {
    vi.stubEnv('CI', '1')
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: undefined })).toBe(true)
  })

  it('CI detection is case-insensitive and trims whitespace', () => {
    vi.stubEnv('CI', '  TRUE  ')
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: undefined })).toBe(true)
  })

  it('does not auto-detect frozen mode when CI=true but stdin is a TTY', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: true })).toBe(false)
  })

  it('does not auto-detect frozen mode when stdin is not a TTY but CI is unset', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: undefined })).toBe(false)
  })

  it('does not auto-detect frozen mode when CI is set to a falsy value', () => {
    vi.stubEnv('CI', 'false')
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({}, { isTTY: undefined })).toBe(false)
  })

  it('--no-frozen overrides the CI auto-detect', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('INTENT_FROZEN', undefined)

    expect(isFrozenMode({ noFrozen: true }, { isTTY: undefined })).toBe(false)
  })

  it('--no-frozen overrides an explicit INTENT_FROZEN=1', () => {
    vi.stubEnv('CI', undefined)
    vi.stubEnv('INTENT_FROZEN', '1')

    expect(isFrozenMode({ noFrozen: true }, { isTTY: true })).toBe(false)
  })

  it('--no-frozen overrides CI+INTENT_FROZEN stacked together', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('INTENT_FROZEN', '1')

    expect(isFrozenMode({ noFrozen: true }, { isTTY: undefined })).toBe(false)
  })

  it('throws when both --frozen and --no-frozen are passed', () => {
    expect(() =>
      isFrozenMode({ frozen: true, noFrozen: true }, { isTTY: true }),
    ).toThrow(/--frozen.*--no-frozen/)
  })
})
