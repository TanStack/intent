import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIntentFsCache } from '../src/fs-cache.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'intent-fs-cache-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('createIntentFsCache', () => {
  it('caches package.json reads', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'test-package' }),
    )
    const cache = createIntentFsCache()

    expect(cache.readPackageJson(root)?.name).toBe('test-package')
    expect(cache.readPackageJson(root)?.name).toBe('test-package')

    expect(cache.getStats()).toEqual(
      expect.objectContaining({
        packageJsonReadCount: 1,
        packageJsonCacheHits: 1,
      }),
    )
  })

  it('caches skill file discovery without exposing cached arrays', () => {
    const skillDir = join(root, 'skills', 'core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: core\n---\n')
    const cache = createIntentFsCache()

    const first = cache.findSkillFiles(join(root, 'skills'))
    first.push('mutated')
    const laterSkillDir = join(root, 'skills', 'later')
    mkdirSync(laterSkillDir, { recursive: true })
    writeFileSync(join(laterSkillDir, 'SKILL.md'), '---\nname: later\n---\n')
    const second = cache.findSkillFiles(join(root, 'skills'))

    expect(second).toHaveLength(1)
    expect(second[0]).toBe(join(skillDir, 'SKILL.md'))
  })
})
