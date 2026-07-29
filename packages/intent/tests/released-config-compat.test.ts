import { describe, expect, it } from 'vitest'
import { compileExcludePatterns } from '../src/core/excludes.js'
import {
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
