import { describe, expect, it } from 'vitest'
import {
  formatSkillUse,
  parseSkillUse,
  SkillUseParseError,
} from '../src/skill-use.js'

describe('skill use helpers', () => {
  it('formats scoped packages and slash-named skills', () => {
    expect(formatSkillUse('@tanstack/query', 'core/fetching')).toBe(
      '@tanstack/query#core/fetching',
    )
  })

  it('formats unscoped packages', () => {
    expect(formatSkillUse('some-lib', 'core')).toBe('some-lib#core')
  })

  it('parses scoped packages and slash-named skills', () => {
    expect(parseSkillUse('@tanstack/query#core/fetching')).toEqual({
      packageName: '@tanstack/query',
      skillName: 'core/fetching',
    })
  })

  it('parses unscoped packages', () => {
    expect(parseSkillUse('some-lib#core')).toEqual({
      packageName: 'some-lib',
      skillName: 'core',
    })
  })

  it('trims whitespace around the use string parts', () => {
    expect(parseSkillUse('  @tanstack/query  #  core/fetching  ')).toEqual({
      packageName: '@tanstack/query',
      skillName: 'core/fetching',
    })
  })

  it('rejects use strings without a separator', () => {
    expect(() => parseSkillUse('@tanstack/query')).toThrow(SkillUseParseError)
    expect(() => parseSkillUse('@tanstack/query')).toThrow(
      'expected <package>#<skill>',
    )
  })

  it('rejects empty packages', () => {
    expect(() => parseSkillUse('#core')).toThrow(SkillUseParseError)
    expect(() => parseSkillUse('#core')).toThrow('package is required')
    expect(() => formatSkillUse('', 'core')).toThrow('package is required')
  })

  it('rejects empty skills', () => {
    expect(() => parseSkillUse('@tanstack/query#')).toThrow(SkillUseParseError)
    expect(() => parseSkillUse('@tanstack/query#')).toThrow('skill is required')
    expect(() => formatSkillUse('@tanstack/query', '')).toThrow(
      'skill is required',
    )
  })
})
