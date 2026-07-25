import { describe, expect, it } from 'vitest'
import { compileExcludePatterns } from '../src/core/excludes.js'
import {
  ALLOW_ALL_NOTICE,
  EMPTY_NOTE,
  MIGRATION_NOTICE,
  applySourcePolicy,
  checkLoadAllowed,
  compileSkillSourcePolicy,
} from '../src/core/source-policy.js'
import { parseSkillSources } from '../src/core/skill-sources.js'
import type { IntentPackage, SkillEntry } from '../src/shared/types.js'

function skill(name: string): SkillEntry {
  return { name, path: `/pkg/skills/${name}/SKILL.md`, description: name }
}

function pkg(
  name: string,
  skillNames: Array<string>,
  kind: IntentPackage['kind'] = 'npm',
): IntentPackage {
  return {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: 'owner/repo', docs: '' },
    skills: skillNames.map(skill),
    packageRoot: `/root/node_modules/${name}`,
    kind,
    source: 'local',
  }
}

function config(value: unknown) {
  return parseSkillSources(value)
}

describe('released 0.3.6 package.json config shapes remain policy-compatible', () => {
  it('keeps an absent intent.skills in migration show-all mode', () => {
    const releasedIntent = { exclude: [] }
    const packages = [pkg('alpha', ['a']), pkg('@scope/beta', ['b', 'c'])]
    const sourcePolicy = compileSkillSourcePolicy(config(undefined))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages },
      { config: config(undefined), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([
      ['alpha', ['a']],
      ['@scope/beta', ['b', 'c']],
    ])
    expect(result.notices).toEqual([MIGRATION_NOTICE])
    expect(
      checkLoadAllowed(
        'alpha#a',
        { packageName: 'alpha', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        '@scope/beta#c',
        { packageName: '@scope/beta', skillName: 'c' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
  })

  it('keeps intent.skills empty as deny-all', () => {
    const releasedIntent = { skills: [], exclude: [] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages: [pkg('alpha', ['a']), pkg('@scope/beta', ['b'])] },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(result.packages).toEqual([])
    expect(result.notices).toEqual([EMPTY_NOTE])
    expect(
      checkLoadAllowed(
        'alpha#a',
        { packageName: 'alpha', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-not-listed')
  })

  it('keeps intent.skills star as allow-all', () => {
    const releasedIntent = { skills: ['*'], exclude: [] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages: [pkg('alpha', ['a']), pkg('@scope/beta', ['b', 'c'])] },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([
      ['alpha', ['a']],
      ['@scope/beta', ['b', 'c']],
    ])
    expect(result.notices).toEqual([ALLOW_ALL_NOTICE])
    expect(
      checkLoadAllowed(
        '@scope/beta#c',
        { packageName: '@scope/beta', skillName: 'c' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
  })

  it('keeps a bare package name allowing every skill in that package', () => {
    const releasedIntent = { skills: ['pkg'], exclude: [] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['a', 'b']), pkg('other', ['c'])] },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([['pkg', ['a', 'b']]])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: other. Add to opt in.',
    ])
    expect(
      checkLoadAllowed(
        'pkg#b',
        { packageName: 'pkg', skillName: 'b' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        'other#c',
        { packageName: 'other', skillName: 'c' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-not-listed')
  })

  it('keeps a scoped package name allowing every skill in that package', () => {
    const releasedIntent = { skills: ['@scope/pkg'], exclude: [] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      {
        packages: [pkg('@scope/pkg', ['a', 'b']), pkg('@scope/other', ['c'])],
      },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([['@scope/pkg', ['a', 'b']]])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @scope/other. Add to opt in.',
    ])
    expect(
      checkLoadAllowed(
        '@scope/pkg#a',
        { packageName: '@scope/pkg', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        '@scope/other#c',
        { packageName: '@scope/other', skillName: 'c' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-not-listed')
  })

  it('keeps a workspace-prefixed package entry kind-specific during discovery', () => {
    const releasedIntent = { skills: ['workspace:pkg'], exclude: [] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      {
        packages: [
          pkg('pkg', ['workspace-skill'], 'workspace'),
          pkg('pkg', ['npm-skill']),
        ],
      },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.kind,
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([['workspace', 'pkg', ['workspace-skill']]])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: pkg. Add to opt in.',
    ])
    expect(
      checkLoadAllowed(
        'pkg#workspace-skill',
        { packageName: 'pkg', skillName: 'workspace-skill' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
  })

  it('keeps a scoped glob allowing every package in that scope', () => {
    const releasedIntent = { skills: ['@scope/*'], exclude: [] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      {
        packages: [
          pkg('@scope/alpha', ['a']),
          pkg('@scope/beta', ['b']),
          pkg('@other/gamma', ['c']),
        ],
      },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([
      ['@scope/alpha', ['a']],
      ['@scope/beta', ['b']],
    ])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @other/gamma. Add to opt in.',
    ])
    expect(
      checkLoadAllowed(
        '@scope/beta#b',
        { packageName: '@scope/beta', skillName: 'b' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        '@other/gamma#c',
        { packageName: '@other/gamma', skillName: 'c' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-not-listed')
  })

  it('keeps a package-level exclude hiding the package', () => {
    const releasedIntent = { skills: ['*'], exclude: ['blocked'] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages: [pkg('allowed', ['a']), pkg('blocked', ['b'])] },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([['allowed', ['a']]])
    expect(result.notices).toEqual([ALLOW_ALL_NOTICE])
    expect(
      checkLoadAllowed(
        'allowed#a',
        { packageName: 'allowed', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        'blocked#b',
        { packageName: 'blocked', skillName: 'b' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-excluded')
  })

  it('keeps a skill-level exclude hiding one skill and leaving its siblings', () => {
    const releasedIntent = { skills: ['pkg'], exclude: ['pkg#b'] }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['a', 'b', 'c'])] },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([['pkg', ['a', 'c']]])
    expect(result.notices).toEqual([])
    expect(
      checkLoadAllowed(
        'pkg#a',
        { packageName: 'pkg', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        'pkg#b',
        { packageName: 'pkg', skillName: 'b' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('skill-excluded')
  })

  it('keeps the released installer partial-selection shape equivalent to selecting one skill', () => {
    const releasedIntent = {
      skills: ['pkg'],
      exclude: ['pkg#b', 'pkg#c'],
    }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['a', 'b', 'c'])] },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([['pkg', ['a']]])
    expect(result.notices).toEqual([])
    expect(
      checkLoadAllowed(
        'pkg#a',
        { packageName: 'pkg', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        'pkg#b',
        { packageName: 'pkg', skillName: 'b' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('skill-excluded')
    expect(
      checkLoadAllowed(
        'pkg#c',
        { packageName: 'pkg', skillName: 'c' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('skill-excluded')
  })

  it('keeps a realistic released config combining names, workspace entries, globs, and excludes', () => {
    const releasedIntent = {
      skills: ['plain', '@scope/*', 'workspace:local'],
      exclude: ['plain#b', '@scope/blocked', '@scope/tools#dangerous'],
    }
    const sourcePolicy = compileSkillSourcePolicy(config(releasedIntent.skills))
    const excludeMatchers = compileExcludePatterns(releasedIntent.exclude)
    const result = applySourcePolicy(
      {
        packages: [
          pkg('plain', ['a', 'b']),
          pkg('@scope/alpha', ['x']),
          pkg('@scope/tools', ['safe', 'dangerous']),
          pkg('@scope/blocked', ['hidden']),
          pkg('local', ['workspace-skill'], 'workspace'),
          pkg('local', ['npm-skill']),
          pkg('unlisted', ['z']),
        ],
      },
      { config: config(releasedIntent.skills), excludeMatchers },
    )

    expect(
      result.packages.map((intentPackage) => [
        intentPackage.kind,
        intentPackage.name,
        intentPackage.skills.map((entry) => entry.name),
      ]),
    ).toEqual([
      ['npm', 'plain', ['a']],
      ['npm', '@scope/alpha', ['x']],
      ['npm', '@scope/tools', ['safe']],
      ['workspace', 'local', ['workspace-skill']],
    ])
    expect(result.notices).toEqual([
      '2 discovered packages ship skills but are not listed in intent.skills: local, unlisted. Add to opt in.',
    ])
    expect(
      checkLoadAllowed(
        'plain#a',
        { packageName: 'plain', skillName: 'a' },
        { sourcePolicy, excludeMatchers },
      ),
    ).toBeNull()
    expect(
      checkLoadAllowed(
        'plain#b',
        { packageName: 'plain', skillName: 'b' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('skill-excluded')
    expect(
      checkLoadAllowed(
        '@scope/blocked#hidden',
        { packageName: '@scope/blocked', skillName: 'hidden' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-excluded')
    expect(
      checkLoadAllowed(
        '@scope/tools#dangerous',
        { packageName: '@scope/tools', skillName: 'dangerous' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('skill-excluded')
    expect(
      checkLoadAllowed(
        'unlisted#z',
        { packageName: 'unlisted', skillName: 'z' },
        { sourcePolicy, excludeMatchers },
      )?.code,
    ).toBe('package-not-listed')
  })
})
