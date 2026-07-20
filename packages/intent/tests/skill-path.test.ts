import { describe, expect, it } from 'vitest'
import { validateSkillPaths } from '../src/core/skill-path.js'

describe('validateSkillPaths', () => {
  it('accepts canonical package-relative directories and rejects unsafe forms', () => {
    expect(
      validateSkillPaths(['skills/fetching', 'skills/query-core']),
    ).toEqual(['skills/fetching', 'skills/query-core'])
    expect(() => validateSkillPaths(['../skills/fetching'])).toThrow()
    expect(() => validateSkillPaths(['skills\\fetching'])).toThrow()
    expect(() => validateSkillPaths(['C:/skills/fetching'])).toThrow()
    expect(() =>
      validateSkillPaths(['//server/share/skills/fetching']),
    ).toThrow()
    expect(() => validateSkillPaths(['/skills/fetching'])).toThrow()
    expect(() => validateSkillPaths(['skills//fetching'])).toThrow()
    expect(() => validateSkillPaths(['skills/./fetching'])).toThrow()
    expect(() => validateSkillPaths(['skills/\0fetching'])).toThrow()
    expect(() =>
      validateSkillPaths(['skills/fetching', 'skills/fetching']),
    ).toThrow()
  })
})
