import semver from 'semver'
import { describe, expect, it } from 'vitest'
import {
  coerceVersion,
  compareVersions,
  normalizeVersion,
  validVersion,
} from '../src/shared/version.js'

// The scanner's helpers must agree with `semver` on every input it might see,
// so each case is checked against the reference implementation directly.
const VERSIONS = [
  '0.0.0',
  '1.0.0',
  '1.0.1',
  '1.1.0',
  '2.0.0',
  '10.0.0',
  '1.10.0',
  '1.2.10',
  'v1.2.3',
  '=1.2.3',
  ' 1.2.3 ',
  '1.2.3+build.7',
  '1.2.3-alpha',
  '1.2.3-alpha.1',
  '1.2.3-alpha.2',
  '1.2.3-alpha.10',
  '1.2.3-alpha.beta',
  '1.2.3-beta',
  '1.2.3-beta.2',
  '1.2.3-beta.11',
  '1.2.3-rc.1',
  '1.2.3-rc.1+build',
  '1.2.3-0',
  '1.2.3-1',
  '1.2.3-a',
  '1.2.3--',
  '1.2.3-0a',
  '1.2.3-01',
  '01.2.3',
  '1.02.3',
  '1.2',
  '1',
  '1.2.3.4',
  'latest',
  'workspace:*',
  'v2',
  '3.x',
  'some 4.5 text',
  'nightly-20240101',
  '9007199254740993.0.0',
  '',
]

describe('validVersion', () => {
  it.each(VERSIONS)('matches semver.valid for %j', (version) => {
    expect(validVersion(version)).toBe(semver.valid(version))
  })
})

describe('coerceVersion', () => {
  it.each(VERSIONS)('matches semver.coerce for %j', (version) => {
    expect(coerceVersion(version)).toBe(semver.coerce(version)?.version ?? null)
  })
})

describe('normalizeVersion', () => {
  it.each(VERSIONS)('matches valid-then-coerce for %j', (version) => {
    expect(normalizeVersion(version)).toBe(
      semver.valid(version) ?? semver.coerce(version)?.version ?? null,
    )
  })
})

describe('compareVersions', () => {
  const valid = VERSIONS.filter((version) => semver.valid(version) !== null)

  it('agrees with semver.compare on every valid pair', () => {
    for (const a of valid) {
      for (const b of valid) {
        expect(compareVersions(a, b), `${a} vs ${b}`).toBe(semver.compare(a, b))
      }
    }
  })

  it('orders the semver.org precedence example', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    const shuffled = [...ordered].reverse()
    expect(shuffled.sort(compareVersions)).toEqual(ordered)
  })

  it('rejects input that is not strict semver', () => {
    expect(() => compareVersions('1.2', '1.2.3')).toThrow(/Invalid Version/)
    expect(() => compareVersions('1.2.3', 'latest')).toThrow(/Invalid Version/)
  })
})
