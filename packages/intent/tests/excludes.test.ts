import { describe, expect, it } from 'vitest'
import {
  compileExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
} from '../src/core/excludes.js'

describe('exclude matching — package level (backward compatible)', () => {
  it('excludes a whole package by exact name', () => {
    const matchers = compileExcludePatterns(['@scope/pkg'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(true)
    expect(isPackageExcluded('@scope/other', matchers)).toBe(false)
  })

  it('excludes a whole package via a package-segment glob', () => {
    const matchers = compileExcludePatterns(['@scope/*'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(true)
    expect(isPackageExcluded('@other/pkg', matchers)).toBe(false)
  })

  it('treats a whole-package exclusion as excluding all of its skills', () => {
    const matchers = compileExcludePatterns(['@scope/pkg'])
    expect(isSkillExcluded('@scope/pkg', 'anything', matchers)).toBe(true)
  })

  it('rejects an overly long pattern', () => {
    expect(() => compileExcludePatterns(['@scope/'.padEnd(201, 'x')])).toThrow(
      'Intent exclude pattern is too long',
    )
  })
})

describe('exclude matching — skill level', () => {
  it('excludes a single named skill without removing the package', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#search-params'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(false)
    expect(isSkillExcluded('@scope/pkg', 'search-params', matchers)).toBe(true)
    expect(isSkillExcluded('@scope/pkg', 'routing', matchers)).toBe(false)
  })

  it('excludes skills matching a skill-segment glob', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#experimental-*'])
    expect(isSkillExcluded('@scope/pkg', 'experimental-router', matchers)).toBe(
      true,
    )
    expect(isSkillExcluded('@scope/pkg', 'stable-router', matchers)).toBe(false)
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(false)
  })

  it('does not match a skill-level pattern against a different package', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#search-params'])
    expect(isSkillExcluded('@scope/other', 'search-params', matchers)).toBe(
      false,
    )
  })

  it('matches a prefixed skill excluded by its canonical name when queried by short alias', () => {
    const matchers = compileExcludePatterns(['@tanstack/router#router/guards'])
    expect(isSkillExcluded('@tanstack/router', 'guards', matchers)).toBe(true)
    expect(isSkillExcluded('@tanstack/router', 'router/guards', matchers)).toBe(
      true,
    )
  })

  it('matches a prefixed skill excluded by short alias when queried by canonical name', () => {
    const matchers = compileExcludePatterns(['@tanstack/router#guards'])
    expect(isSkillExcluded('@tanstack/router', 'router/guards', matchers)).toBe(
      true,
    )
  })
})

describe('exclude matching — #* whole-package shortcut', () => {
  it('treats pkg#* as a whole-package exclusion', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#*'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(true)
    expect(isSkillExcluded('@scope/pkg', 'anything', matchers)).toBe(true)
  })

  it('treats *#* as excluding every package', () => {
    const matchers = compileExcludePatterns(['*#*'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(true)
    expect(isPackageExcluded('@other/thing', matchers)).toBe(true)
  })

  it('treats a multi-star skill segment (pkg#**) as the whole-package shortcut', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#**'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(true)
    expect(isSkillExcluded('@scope/pkg', 'anything', matchers)).toBe(true)
  })
})

describe('exclude matching — degenerate patterns are safe no-ops', () => {
  it('treats an empty skill segment (pkg#) as a no-op, not whole-package', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#'])
    expect(isPackageExcluded('@scope/pkg', matchers)).toBe(false)
    expect(isSkillExcluded('@scope/pkg', 'routing', matchers)).toBe(false)
  })

  it('treats an empty package segment (#skill) as matching no real package', () => {
    const matchers = compileExcludePatterns(['#search-params'])
    expect(isSkillExcluded('@scope/pkg', 'search-params', matchers)).toBe(false)
  })

  it('keeps the skill after the first # when the name has multiple #', () => {
    const matchers = compileExcludePatterns(['@scope/pkg#a#b'])
    expect(isSkillExcluded('@scope/pkg', 'a#b', matchers)).toBe(true)
    expect(isSkillExcluded('@scope/pkg', 'a', matchers)).toBe(false)
  })
})

describe('exclude matching — cross-package skill patterns', () => {
  it('excludes a skill name across every package with *#experimental-*', () => {
    const matchers = compileExcludePatterns(['*#experimental-*'])
    expect(isSkillExcluded('@scope/a', 'experimental-x', matchers)).toBe(true)
    expect(isSkillExcluded('@other/b', 'experimental-y', matchers)).toBe(true)
    expect(isSkillExcluded('@scope/a', 'stable', matchers)).toBe(false)
    expect(isPackageExcluded('@scope/a', matchers)).toBe(false)
  })
})

describe('exclude matching — combined patterns', () => {
  it('applies the union of package-level and skill-level patterns', () => {
    const matchers = compileExcludePatterns([
      '@scope/gone',
      '@scope/kept#experimental-*',
    ])
    expect(isPackageExcluded('@scope/gone', matchers)).toBe(true)
    expect(isPackageExcluded('@scope/kept', matchers)).toBe(false)
    expect(isSkillExcluded('@scope/kept', 'experimental-x', matchers)).toBe(
      true,
    )
    expect(isSkillExcluded('@scope/kept', 'stable', matchers)).toBe(false)
  })
})
