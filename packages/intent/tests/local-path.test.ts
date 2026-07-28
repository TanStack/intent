import { describe, expect, it } from 'vitest'
import { containsLocalPath } from '../src/shared/local-path.js'

describe('containsLocalPath', () => {
  it.each([
    'C:\\Users\\person\\project\\SKILL.md',
    '/Users/alice',
    '/Users/person/project/SKILL.md',
    '/home/alice',
    '/home/person/project/package.json',
    './packages/router/SKILL.md',
    'node_modules/@scope/package/skills/core/SKILL.md',
    'file:///workspace/project/SKILL.md',
  ])('detects local path %s', (value) => {
    expect(containsLocalPath(value)).toBe(true)
  })

  it.each([
    '/users/:id',
    '/posts/:slug',
    '/media/logo',
    '/opt/pricing',
    '/workspace/list',
    'Use the router/search API',
    '@scope/package#skill',
  ])('preserves non-filesystem value %s', (value) => {
    expect(containsLocalPath(value)).toBe(false)
  })
})
