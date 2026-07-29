import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { containsLocalPath } from '../src/shared/local-path.js'
import { isPathWithin } from '../src/shared/utils.js'

describe('isPathWithin', () => {
  const parent = join(tmpdir(), 'intent-path-parent')
  const child = join(parent, 'child')

  it('recognizes the same path and child paths', () => {
    expect(isPathWithin(parent, parent)).toBe(true)
    expect(isPathWithin(parent, child)).toBe(true)
    expect(isPathWithin(parent, join(parent, '..foo'))).toBe(true)
  })

  it('rejects parent and sibling paths', () => {
    expect(isPathWithin(child, parent)).toBe(false)
    expect(isPathWithin(parent, join(tmpdir(), 'intent-path-sibling'))).toBe(
      false,
    )
  })

  it('is directional', () => {
    expect(isPathWithin(parent, child)).toBe(true)
    expect(isPathWithin(child, parent)).toBe(false)
  })
})

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
