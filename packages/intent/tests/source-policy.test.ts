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

describe('compileSkillSourcePolicy', () => {
  it('lets a package selector permit every skill in that package', () => {
    const policy = compileSkillSourcePolicy(config(['pkg']))
    const availableSkills = [skill('one'), skill('two')]

    expect(policy.permitsPackage('pkg', 'npm')).toBe(true)
    expect(policy.permitsSkill('pkg', 'one', 'npm', availableSkills)).toBe(true)
    expect(policy.permitsSkill('pkg', 'two', 'npm', availableSkills)).toBe(true)
  })

  it('matches a canonical selector to an unambiguous short skill request', () => {
    const policy = compileSkillSourcePolicy(
      config(['@scope/router-core#router-core/auth']),
    )
    const availableSkills = [skill('router-core/auth')]

    expect(
      policy.permitsSkill(
        '@scope/router-core',
        'router-core/auth',
        'npm',
        availableSkills,
      ),
    ).toBe(true)
    expect(
      policy.permitsSkill(
        '@scope/router-core',
        'other',
        'npm',
        availableSkills,
      ),
    ).toBe(false)
  })

  it('matches a short selector to an unambiguous canonical skill', () => {
    const policy = compileSkillSourcePolicy(config(['@scope/router-core#auth']))
    const availableSkills = [skill('router-core/auth')]

    expect(
      policy.permitsSkill(
        '@scope/router-core',
        'router-core/auth',
        'npm',
        availableSkills,
      ),
    ).toBe(true)
  })

  it('uses exact-first resolution when short and canonical skills collide', () => {
    const shortPolicy = compileSkillSourcePolicy(config(['pkg#foo']))
    const canonicalPolicy = compileSkillSourcePolicy(config(['pkg#pkg/foo']))
    const availableSkills = [skill('foo'), skill('pkg/foo')]

    expect(shortPolicy.permitsSkill('pkg', 'foo', 'npm', availableSkills)).toBe(
      true,
    )
    expect(
      shortPolicy.permitsSkill('pkg', 'pkg/foo', 'npm', availableSkills),
    ).toBe(false)
    expect(
      canonicalPolicy.permitsSkill('pkg', 'pkg/foo', 'npm', availableSkills),
    ).toBe(true)
    expect(
      canonicalPolicy.permitsSkill('pkg', 'foo', 'npm', availableSkills),
    ).toBe(false)
  })

  it('keeps exact skill selectors kind-aware', () => {
    const npmPolicy = compileSkillSourcePolicy(config(['pkg#auth']))
    const workspacePolicy = compileSkillSourcePolicy(
      config(['workspace:pkg#auth']),
    )
    const availableSkills = [skill('auth')]

    expect(npmPolicy.permitsPackage('pkg', 'workspace')).toBe(false)
    expect(
      npmPolicy.permitsSkill('pkg', 'auth', 'workspace', availableSkills),
    ).toBe(false)
    expect(workspacePolicy.permitsPackage('pkg', 'npm')).toBe(false)
    expect(
      workspacePolicy.permitsSkill('pkg', 'auth', 'npm', availableSkills),
    ).toBe(false)
  })
})

describe('checkLoadAllowed', () => {
  it('defers exact skill permission until the complete inventory is available', () => {
    const policy = compileSkillSourcePolicy(config(['pkg#selected']))
    const parsed = { packageName: 'pkg', skillName: 'arbitrary' }
    const params = { policy, excludeMatchers: [] }

    expect(checkLoadAllowed('pkg#arbitrary', parsed, params)).toBeNull()
    expect(
      checkLoadAllowed('pkg#arbitrary', parsed, {
        ...params,
        packageKind: 'npm',
        availableSkills: [skill('selected'), skill('arbitrary')],
      }),
    ).toMatchObject({ code: 'skill-not-listed' })
  })
})

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

  it('keeps only an exact selected skill and withholds its sibling', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['billing', 'auth'])] },
      { config: config(['pkg#billing']), excludeMatchers: [] },
    )

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.skills.map((entry) => entry.name)).toEqual([
      'billing',
    ])
    expect(result.hiddenSources).toEqual([{ name: 'pkg', skillCount: 1 }])
  })

  it('does not match a canonical selector to a distinct short skill', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/router-core', ['auth'])] },
      {
        config: config(['@scope/router-core#router-core/auth']),
        excludeMatchers: [],
      },
    )

    expect(result.packages[0]?.skills).toEqual([])
    expect(result.notices).toEqual([
      '1 discovered skill source has 1 skill not listed in intent.skills: @scope/router-core. Add to opt in.',
      '"@scope/router-core#router-core/auth" is declared in intent.skills but was not discovered.',
    ])
  })

  it('matches a short exact selector to a discovered canonical skill', () => {
    const result = applySourcePolicy(
      { packages: [pkg('@scope/router-core', ['router-core/auth'])] },
      {
        config: config(['@scope/router-core#auth']),
        excludeMatchers: [],
      },
    )

    expect(result.packages[0]?.skills.map((entry) => entry.name)).toEqual([
      'router-core/auth',
    ])
    expect(result.notices).toEqual([])
  })

  it('prefers an exact short skill over its canonical alias collision', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['foo', 'pkg/foo'])] },
      { config: config(['pkg#foo']), excludeMatchers: [] },
    )

    expect(result.packages[0]?.skills.map((entry) => entry.name)).toEqual([
      'foo',
    ])
  })

  it('permits only the exact canonical skill when its short name collides', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['foo', 'pkg/foo'])] },
      { config: config(['pkg#pkg/foo']), excludeMatchers: [] },
    )

    expect(result.packages[0]?.skills.map((entry) => entry.name)).toEqual([
      'pkg/foo',
    ])
  })

  it('permits a canonical skill through an unambiguous short alias', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['pkg/foo'])] },
      { config: config(['pkg#foo']), excludeMatchers: [] },
    )

    expect(result.packages[0]?.skills.map((entry) => entry.name)).toEqual([
      'pkg/foo',
    ])
  })

  it('reports an exact selector whose skill was not discovered', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['other'])] },
      { config: config(['pkg#missing']), excludeMatchers: [] },
    )

    expect(result.notices).toEqual([
      '1 discovered skill source has 1 skill not listed in intent.skills: pkg. Add to opt in.',
      '"pkg#missing" is declared in intent.skills but was not discovered.',
    ])
  })

  it('does not report a present but excluded exact selector as undiscovered', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['selected'])] },
      {
        config: config(['pkg#selected']),
        excludeMatchers: compileExcludePatterns(['pkg#selected']),
      },
    )

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.skills).toEqual([])
    expect(result.notices).toEqual([])
  })

  it('uses a truthful partial-withholding notice for human output', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['selected', 'sibling'])] },
      { config: config(['pkg#selected']), excludeMatchers: [] },
    )

    expect(result.notices).toEqual([
      '1 discovered skill source has 1 skill not listed in intent.skills: pkg. Add to opt in.',
    ])
  })

  it('keeps a partial-withholding agent notice count-only', () => {
    const result = applySourcePolicy(
      { packages: [pkg('secret-pkg', ['selected', 'secret-sibling'])] },
      {
        audience: 'agent',
        config: config(['secret-pkg#selected']),
        excludeMatchers: [],
      },
    )

    expect(result.notices).toEqual([
      '1 discovered skill source has 1 skill that is not listed in intent.skills. Ask the user to run `intent list --show-hidden` outside the agent session to review candidates.',
    ])
    expect(result.notices[0]).not.toContain('secret-pkg')
    expect(result.notices[0]).not.toContain('selected')
    expect(result.notices[0]).not.toContain('secret-sibling')
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

  it('lets a skill exclude override a matching exact selector', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['selected'])] },
      {
        config: config(['pkg#selected']),
        excludeMatchers: compileExcludePatterns(['pkg#selected']),
      },
    )

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.skills).toEqual([])
  })

  it('withholds an unselected sibling without excluding its package', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['selected', 'sibling'])] },
      {
        config: config(['pkg#selected']),
        excludeMatchers: compileExcludePatterns(['pkg#unrelated']),
      },
    )

    expect(names(result.packages)).toEqual(['pkg'])
    expect(result.packages[0]?.skills.map((entry) => entry.name)).toEqual([
      'selected',
    ])
    expect(result.hiddenSources).toEqual([{ name: 'pkg', skillCount: 1 }])
  })

  it('keeps an allowed package row when all of its skills are excluded', () => {
    const result = applySourcePolicy(
      { packages: [pkg('pkg', ['one', 'two'])] },
      {
        config: config(['pkg']),
        excludeMatchers: compileExcludePatterns(['pkg#one', 'pkg#two']),
      },
    )

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.skills).toEqual([])
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
