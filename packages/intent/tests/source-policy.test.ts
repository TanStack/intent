import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compileExcludePatterns,
  compileWildcardPattern,
} from '../src/core/excludes.js'
import {
  ALLOW_ALL_NOTICE,
  EMPTY_NOTE,
  MIGRATION_NOTICE,
  applySourcePolicy,
  checkLoadAllowed,
  compileSkillSourcePolicy,
  readSkillSourcesConfig,
} from '../src/core/source-policy.js'
import { parseSkillSources } from '../src/core/skill-sources.js'
import type * as Excludes from '../src/core/excludes.js'
import type { IntentPackage, SkillEntry } from '../src/shared/types.js'

vi.mock('../src/core/excludes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Excludes>()
  return {
    ...actual,
    compileWildcardPattern: vi.fn(actual.compileWildcardPattern),
  }
})

const realTmpdir = realpathSync(tmpdir())

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

function names(packages: Array<IntentPackage>): Array<string> {
  return packages.map((p) => p.name)
}

describe('applySourcePolicy — allowlist matrix', () => {
  it('includes a listed and discovered package', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x'])] },
      { config: config(['@scope/a']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(result.notices).toEqual([])
  })

  it('includes every package matched by an npm allowlist glob', () => {
    const result = applySourcePolicy(
      {
        packages: [
          pkg('@tanstack/query', ['query']),
          pkg('@tanstack/router', ['router']),
          pkg('@other/package', ['other']),
        ],
      },
      { config: config(['@tanstack/*']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual([
      '@tanstack/query',
      '@tanstack/router',
    ])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @other/package. Add to opt in.',
    ])
  })

  it('keeps workspace allowlist globs kind-specific', () => {
    const result = applySourcePolicy(
      {
        packages: [
          pkg('@scope/workspace', ['workspace'], 'workspace'),
          pkg('@scope/npm', ['npm']),
        ],
      },
      { config: config(['workspace:@scope/*']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/workspace'])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @scope/npm. Add to opt in.',
    ])
  })

  it('warns when an allowlist glob matches no discovered package', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@other/package', ['other'])] },
      { config: config(['@tanstack/*']), excludeMatchers: [] },
    )
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @other/package. Add to opt in.',
      '"@tanstack/*" is declared in intent.skills but was not discovered.',
    ])
  })

  it('compiles each allowlist glob once per policy application', () => {
    const compile = vi.mocked(compileWildcardPattern)
    compile.mockClear()

    applySourcePolicy(
      {
        packages: [
          pkg('@scope/one', ['one']),
          pkg('@scope/two', ['two']),
          pkg('@other/three', ['three']),
        ],
      },
      {
        config: config(['@scope/*', '@other/*']),
        excludeMatchers: [],
      },
    )

    expect(compile).toHaveBeenCalledTimes(2)
  })

  it('drops an unlisted discovered package and warns', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x']), pkg('@scope/b', ['y'])] },
      { config: config(['@scope/a']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @scope/b. Add to opt in.',
    ])
  })

  it('collapses several unlisted packages into one sorted summary warning', () => {
    const result = applySourcePolicy(
      {
        packages: [
          pkg('@scope/a', ['x']),
          pkg('@scope/c', ['y']),
          pkg('@scope/b', ['z']),
        ],
      },
      { config: config(['@scope/a']), excludeMatchers: [] },
    )
    expect(result.notices).toEqual([
      '2 discovered packages ship skills but are not listed in intent.skills: @scope/b, @scope/c. Add to opt in.',
    ])
  })

  it('warns when a listed source was not discovered', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x'])] },
      { config: config(['@scope/a', '@scope/missing']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(result.notices).toEqual([
      '"@scope/missing" is declared in intent.skills but was not discovered.',
    ])
  })

  it('does not authorize an npm-discovered foo via workspace:foo', () => {
    const result = applySourcePolicy(
      { packages: [pkg('foo', ['x'])] },
      { config: config(['workspace:foo']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual([])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: foo. Add to opt in.',
      '"workspace:foo" is declared in intent.skills but was not discovered.',
    ])
  })

  it('authorizes a workspace-discovered foo via workspace:foo', () => {
    const result = applySourcePolicy(
      { packages: [pkg('foo', ['x'], 'workspace')] },
      { config: config(['workspace:foo']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['foo'])
    expect(result.notices).toEqual([])
  })

  it('does not trust a discovered dependency just because its dependent is listed', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/listed', ['x']), pkg('@scope/dep', ['y'])] },
      { config: config(['@scope/listed']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/listed'])
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @scope/dep. Add to opt in.',
    ])
  })

  it('emits unlisted warnings before not-discovered warnings deterministically', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/unlisted', ['x'])] },
      {
        config: config(['@scope/missing']),
        excludeMatchers: [],
      },
    )
    expect(result.notices).toEqual([
      '1 discovered package ships skills but is not listed in intent.skills: @scope/unlisted. Add to opt in.',
      '"@scope/missing" is declared in intent.skills but was not discovered.',
    ])
  })

  it('does not mutate the input scan packages', () => {
    const input = pkg('@scope/a', ['keep', 'drop'])
    applySourcePolicy(
      { packages: [input] },
      {
        config: config(['@scope/a']),
        excludeMatchers: compileExcludePatterns(['@scope/a#drop']),
      },
    )
    expect(input.skills.map((s) => s.name)).toEqual(['keep', 'drop'])
  })
})

function skillNames(packages: Array<IntentPackage>): Array<Array<string>> {
  return packages.map((p) => p.skills.map((s) => s.name))
}

describe('applySourcePolicy — skill-level allowlist entries', () => {
  it('surfaces only the named skill from a listed package', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x', 'y'])] },
      { config: config(['@scope/a#x']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(skillNames(result.packages)).toEqual([['x']])
  })

  it('reports skills a listed package ships that no entry allows', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x', 'y', 'z'])] },
      { config: config(['@scope/a#x']), excludeMatchers: [] },
    )

    expect(result.hiddenSources).toEqual([
      { name: '@scope/a', skillCount: 2, hiddenSkills: ['y', 'z'] },
    ])
    expect(result.notices).toEqual([
      '2 skills from listed packages are not listed in intent.skills: @scope/a#y, @scope/a#z. Add to opt in.',
    ])
  })

  it('does not report excluded skills as hidden', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x', 'y'])] },
      {
        config: config(['@scope/a']),
        excludeMatchers: compileExcludePatterns(['@scope/a#y']),
      },
    )

    expect(result.hiddenSources).toEqual([])
    expect(result.notices).toEqual([])
  })

  it('matches a glob in the skill selector', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['fetch-one', 'fetch-two', 'other'])] },
      { config: config(['@scope/a#fetch-*']), excludeMatchers: [] },
    )
    expect(skillNames(result.packages)).toEqual([['fetch-one', 'fetch-two']])
  })

  it('keeps a skill entry kind-specific', () => {
    const result = applySourcePolicy(
      {
        packages: [
          pkg('@scope/a', ['x'], 'workspace'),
          pkg('@scope/a', ['x'], 'npm'),
        ],
      },
      { config: config(['workspace:@scope/a#x']), excludeMatchers: [] },
    )
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.kind).toBe('workspace')
  })

  it('matches a prefixed skill by its short alias', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/ui', ['ui/theme', 'ui/layout'])] },
      { config: config(['@scope/ui#theme']), excludeMatchers: [] },
    )
    expect(skillNames(result.packages)).toEqual([['ui/theme']])
  })

  it('reports a skill entry that matched no discovered skill', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x'])] },
      { config: config(['@scope/a#nope']), excludeMatchers: [] },
    )
    expect(result.notices).toEqual([
      '1 skill from listed packages is not listed in intent.skills: @scope/a#x. Add to opt in.',
      '"@scope/a#nope" is declared in intent.skills but was not discovered.',
    ])
  })

  it('still lets an exclude hide a skill that a skill entry allows', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x', 'y'])] },
      {
        config: config(['@scope/a#x']),
        excludeMatchers: compileExcludePatterns(['@scope/a#x']),
      },
    )
    expect(skillNames(result.packages)).toEqual([[]])
  })
})

describe('checkLoadAllowed — skill-level allowlist entries', () => {
  const use = '@scope/a#y'
  const parsed = { packageName: '@scope/a', skillName: 'y' }

  it('allows a skill named by a skill-level entry', () => {
    expect(
      checkLoadAllowed(
        '@scope/a#x',
        { packageName: '@scope/a', skillName: 'x' },
        {
          sourcePolicy: compileSkillSourcePolicy(config(['@scope/a#x'])),
          excludeMatchers: [],
        },
      ),
    ).toBeNull()
  })

  it('refuses a skill the entry does not name, without claiming the package is unlisted', () => {
    const refusal = checkLoadAllowed(use, parsed, {
      sourcePolicy: compileSkillSourcePolicy(config(['@scope/a#x'])),
      excludeMatchers: [],
    })
    expect(refusal?.code).toBe('skill-not-listed')
    expect(refusal?.message).toContain('"@scope/a#y"')
    expect(refusal?.message).not.toContain('package "@scope/a" is not listed')
  })

  it('still refuses a package that is not listed at all', () => {
    const refusal = checkLoadAllowed(use, parsed, {
      sourcePolicy: compileSkillSourcePolicy(config(['@other/b#x'])),
      excludeMatchers: [],
    })
    expect(refusal?.code).toBe('package-not-listed')
  })
})

describe('applySourcePolicy — permit-all and empty modes', () => {
  it('unqualified exclude hides both an npm and a workspace package of the same name (kind-agnostic, deliberate)', () => {
    const result = applySourcePolicy(
      {
        packages: [pkg('foo', ['x'], 'npm'), pkg('foo', ['y'], 'workspace')],
      },
      {
        config: config(['*']),
        excludeMatchers: compileExcludePatterns(['foo']),
      },
    )
    expect(names(result.packages)).toEqual([])
  })

  it('permits every discovered source under allow-all with a loud notice', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x']), pkg('@scope/b', ['y'])] },
      { config: config(['*']), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/a', '@scope/b'])
    expect(result.notices).toEqual([ALLOW_ALL_NOTICE])
  })

  it('permits every discovered source under absent config with a migration warning', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x'])] },
      { config: config(undefined), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(result.notices).toEqual([MIGRATION_NOTICE])
  })

  it('permits nothing under empty config with a quiet info note', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x'])] },
      { config: config([]), excludeMatchers: [] },
    )
    expect(names(result.packages)).toEqual([])
    expect(result.notices).toEqual([EMPTY_NOTE])
  })

  it('stays quiet under empty config even with several discovered packages', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x']), pkg('@scope/b', ['y'])] },
      { config: config([]), excludeMatchers: [] },
    )
    expect(result.notices).toEqual([EMPTY_NOTE])
  })
})

describe('applySourcePolicy — exclude interaction', () => {
  it('subtracts an excluded package on top of allow-all', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x']), pkg('@scope/bad', ['y'])] },
      {
        config: config(['*']),
        excludeMatchers: compileExcludePatterns(['@scope/bad']),
      },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
  })

  it('subtracts an excluded package on top of absent (migration) mode', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x']), pkg('@scope/bad', ['y'])] },
      {
        config: config(undefined),
        excludeMatchers: compileExcludePatterns(['@scope/bad']),
      },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(result.notices).toEqual([MIGRATION_NOTICE])
  })

  it('treats an unlisted+excluded package as excluded with no unlisted warning', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['x']), pkg('@scope/bad', ['y'])] },
      {
        config: config(['@scope/a']),
        excludeMatchers: compileExcludePatterns(['@scope/bad']),
      },
    )
    expect(names(result.packages)).toEqual(['@scope/a'])
    expect(result.notices).toEqual([])
  })

  it('does not report a listed+excluded package as undiscovered', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/bad', ['y'])] },
      {
        config: config(['@scope/bad']),
        excludeMatchers: compileExcludePatterns(['@scope/bad']),
      },
    )
    expect(names(result.packages)).toEqual([])
    expect(result.notices).toEqual([])
  })

  it('removes skill-level excluded skills while keeping the package', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/a', ['keep', 'drop'])] },
      {
        config: config(['@scope/a']),
        excludeMatchers: compileExcludePatterns(['@scope/a#drop']),
      },
    )
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.skills.map((s) => s.name)).toEqual(['keep'])
  })
})

describe('applySourcePolicy — warning dedup', () => {
  it('emits each warning only once within a single call', () => {
    const result = applySourcePolicy(
      {
        packages: [
          pkg('@scope/a', ['x']),
          pkg('@scope/b', ['y']),
          pkg('@scope/c', ['z']),
        ],
      },
      { config: config(['@scope/a']), excludeMatchers: [] },
    )
    const counts = result.notices.reduce<Record<string, number>>(
      (acc, notice) => {
        acc[notice] = (acc[notice] ?? 0) + 1
        return acc
      },
      {},
    )
    expect(Object.values(counts).every((count) => count === 1)).toBe(true)
  })
})

describe('readSkillSourcesConfig', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(realTmpdir, 'intent-policy-config-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writeJson(filePath: string, data: unknown): void {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(data, null, 2))
  }

  it('returns absent when no package.json declares intent.skills', () => {
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    expect(readSkillSourcesConfig(root)).toEqual({ mode: 'absent' })
  })

  it('returns empty when intent.skills is an empty array', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: [] },
    })
    expect(readSkillSourcesConfig(root)).toEqual({ mode: 'empty' })
  })

  it('parses an explicit allowlist', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@scope/a', 'workspace:b'] },
    })
    expect(readSkillSourcesConfig(root)).toEqual({
      mode: 'explicit',
      sources: [
        { raw: '@scope/a', id: '@scope/a', kind: 'npm' },
        { raw: 'workspace:b', id: 'b', kind: 'workspace' },
      ],
    })
  })

  it('prefers the nearest package.json that declares the key over the workspace root', () => {
    const appDir = join(root, 'packages', 'app')
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
      intent: { skills: ['@scope/root'] },
    })
    writeJson(join(appDir, 'package.json'), {
      name: '@scope/app',
      intent: { skills: ['@scope/app-local'] },
    })

    expect(readSkillSourcesConfig(appDir)).toEqual({
      mode: 'explicit',
      sources: [
        { raw: '@scope/app-local', id: '@scope/app-local', kind: 'npm' },
      ],
    })
  })

  it('ignores a null intent.skills so it cannot shadow a stricter parent', () => {
    const appDir = join(root, 'packages', 'app')
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
      intent: { skills: ['@scope/root'] },
    })
    writeJson(join(appDir, 'package.json'), {
      name: '@scope/app',
      intent: { skills: null },
    })

    expect(readSkillSourcesConfig(appDir)).toEqual({
      mode: 'explicit',
      sources: [{ raw: '@scope/root', id: '@scope/root', kind: 'npm' }],
    })
  })
})
