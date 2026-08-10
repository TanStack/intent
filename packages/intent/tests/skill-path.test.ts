import { describe, expect, it } from 'vitest'
import {
  validateSkillPath,
  validateSkillPaths,
} from '../src/core/skill-path.js'

describe('validateSkillPath', () => {
  it('returns canonical paths without normalization', () => {
    const path = 'skills/space name/SKILL.md'

    expect(validateSkillPath(path)).toBe(path)
    expect(validateSkillPath('a'.repeat(1024))).toBe('a'.repeat(1024))
  })

  it('rejects parent traversal segments', () => {
    expect(() => validateSkillPath('skills/../outside.md')).toThrow(
      'Skill path must not contain . or .. segments',
    )
  })

  it.each([
    '',
    '/skills/SKILL.md',
    'skills/SKILL.md/',
    'skills//SKILL.md',
    './skills/SKILL.md',
    'skills/./SKILL.md',
    '../skills/SKILL.md',
    'C:/skills/SKILL.md',
    'C:skills/SKILL.md',
    'C:\\skills\\SKILL.md',
    '\\\\server\\share\\SKILL.md',
    'skills\\SKILL.md',
    'skills/\u0000SKILL.md',
    'skills/\u001fSKILL.md',
    'skills/\u007fSKILL.md',
    'skills/\u009fSKILL.md',
    'skills/\u061cSKILL.md',
    'skills/\u200eSKILL.md',
    'skills/\u200fSKILL.md',
    'skills/\u202eSKILL.md',
    'skills/\u2066SKILL.md',
    'a'.repeat(1025),
    '\u00e9'.repeat(513),
  ])('rejects a noncanonical path', (path) => {
    expect(() => validateSkillPath(path)).toThrow()
  })
})

describe('validateSkillPaths', () => {
  it('returns the original validated strings without mutating the input', () => {
    const paths = ['skills/a/SKILL.md', 'skills/b/SKILL.md']

    expect(validateSkillPaths(paths)).toEqual(paths)
    expect(paths).toEqual(['skills/a/SKILL.md', 'skills/b/SKILL.md'])
  })

  it('rejects duplicate paths', () => {
    expect(() =>
      validateSkillPaths(['skills/a/SKILL.md', 'skills/a/SKILL.md']),
    ).toThrow('Duplicate skill path: skills/a/SKILL.md')
  })
})
