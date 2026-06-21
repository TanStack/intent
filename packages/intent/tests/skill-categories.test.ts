import { describe, expect, it } from 'vitest'
import {
  getSkillCategory,
  isGeneratedMappingSkill,
} from '../src/skills/categories.js'

describe('skill categories', () => {
  it('treats empty and unknown types as task skills', () => {
    expect(getSkillCategory({})).toBe('task')
    expect(getSkillCategory({ type: 'core' })).toBe('task')
    expect(getSkillCategory({ type: '  CORE  ' })).toBe('task')
  })

  it('categorizes non-task skill types', () => {
    expect(getSkillCategory({ type: 'reference' })).toBe('reference')
    expect(getSkillCategory({ type: 'meta' })).toBe('meta')
    expect(getSkillCategory({ type: 'maintainer' })).toBe('maintainer')
    expect(getSkillCategory({ type: 'maintainer-only' })).toBe('maintainer')
  })

  it('maps only task skills into generated guidance', () => {
    expect(isGeneratedMappingSkill({ type: 'core' })).toBe(true)
    expect(isGeneratedMappingSkill({ type: 'reference' })).toBe(false)
    expect(isGeneratedMappingSkill({ type: 'meta' })).toBe(false)
    expect(isGeneratedMappingSkill({ type: 'maintainer-only' })).toBe(false)
  })
})
