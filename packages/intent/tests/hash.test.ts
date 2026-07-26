import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { computeSkillContentHash } from '../src/core/lockfile/hash.js'

const roots: Array<string> = []

function skillRoot(): { root: string; skill: string } {
  const root = mkdtempSync(join(tmpdir(), 'intent-hash-'))
  const skill = join(root, 'skills', 'fetching')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), 'Fetch\r\n')
  roots.push(root)
  return { root, skill }
}

afterEach(() => {
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }))
})

describe('computeSkillContentHash', () => {
  it('pins the lockfile content digest framing', () => {
    const { root, skill } = skillRoot()
    writeFileSync(
      join(skill, 'SKILL.md'),
      Buffer.from('---\nname: pinned\ndescription: Pinned hash fixture\n---\n'),
    )
    mkdirSync(join(skill, 'references'))
    writeFileSync(join(skill, 'references', 'zeta.md'), Buffer.from('Zeta\n'))
    writeFileSync(
      join(skill, 'references', 'alpha.md'),
      Buffer.from('Alpha\r\n'),
    )

    // Changing this value invalidates every existing intent.lock, so digest framing changes must be deliberate.
    expect(
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toBe(
      'sha256-985f0fe3329f5eb4cbf3202c9d34da0c53d404292423a15a25d914b7fadc6ce7',
    )
  })

  it('normalizes text line endings', () => {
    const { root, skill } = skillRoot()
    const baseline = computeSkillContentHash({
      packageRoot: root,
      skillDir: skill,
    })
    writeFileSync(join(skill, 'SKILL.md'), 'Fetch\n')
    expect(
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toBe(baseline)
    writeFileSync(join(skill, 'SKILL.md'), 'Fetch\r')
    expect(
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toBe(baseline)
  })

  it.each(['references', 'assets', 'scripts'])(
    'includes files under %s',
    (directory) => {
      const { root, skill } = skillRoot()
      mkdirSync(join(skill, directory))
      writeFileSync(join(skill, directory, 'resource.txt'), 'One')
      const baseline = computeSkillContentHash({
        packageRoot: root,
        skillDir: skill,
      })

      writeFileSync(join(skill, directory, 'resource.txt'), 'Two')

      expect(
        computeSkillContentHash({ packageRoot: root, skillDir: skill }),
      ).not.toBe(baseline)
    },
  )

  it('ignores unrelated sibling files', () => {
    const { root, skill } = skillRoot()
    const baseline = computeSkillContentHash({
      packageRoot: root,
      skillDir: skill,
    })
    writeFileSync(join(skill, 'notes.md'), 'Not a supported resource')

    expect(
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toBe(baseline)
  })

  it('preserves binary bytes', () => {
    const { root, skill } = skillRoot()
    writeFileSync(join(skill, 'SKILL.md'), Buffer.from([0xff, 13, 10]))
    const binary = computeSkillContentHash({
      packageRoot: root,
      skillDir: skill,
    })
    writeFileSync(join(skill, 'SKILL.md'), Buffer.from([0xff, 10]))
    expect(
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).not.toBe(binary)
  })

  it('rejects an oversized skill file', () => {
    const { root, skill } = skillRoot()
    writeFileSync(join(skill, 'SKILL.md'), Buffer.alloc(4 * 1024 * 1024 + 1))

    expect(() =>
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toThrow('Hash file size limit exceeded')
  })

  it('follows in-bound links and rejects dangling or escaping links when links are supported', () => {
    const { root, skill } = skillRoot()
    const target = join(root, 'shared.md')
    writeFileSync(target, 'Shared')
    mkdirSync(join(skill, 'references'))
    try {
      symlinkSync(target, join(skill, 'references', 'linked.md'))
    } catch {
      return
    }
    expect(
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toMatch(/^sha256-/)
    symlinkSync(
      join(root, 'missing.md'),
      join(skill, 'references', 'dangling.md'),
    )
    expect(() =>
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toThrow()
    rmSync(join(skill, 'references', 'dangling.md'))
    const outside = mkdtempSync(join(tmpdir(), 'intent-hash-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'outside.md'), 'Outside')
    symlinkSync(
      join(outside, 'outside.md'),
      join(skill, 'references', 'outside.md'),
    )
    expect(() =>
      computeSkillContentHash({ packageRoot: root, skillDir: skill }),
    ).toThrow()
  })
})
