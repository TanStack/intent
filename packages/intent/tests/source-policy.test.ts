import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compileExcludePatterns } from '../src/core/excludes.js'
import {
  ALLOW_ALL_NOTICE,
  EMPTY_NOTE,
  MIGRATION_NOTICE,
  applySourcePolicy,
  readSkillSourcesConfig,
} from '../src/core/source-policy.js'
import { parseSkillSources } from '../src/core/skill-sources.js'
import type { IntentPackage, SkillEntry } from '../src/types.js'

const realTmpdir = realpathSync(tmpdir())

function skill(name: string): SkillEntry {
  return { name, path: `/pkg/skills/${name}/SKILL.md`, description: name }
}

function pkg(name: string, skillNames: Array<string>): IntentPackage {
  return {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: 'owner/repo', docs: '' },
    skills: skillNames.map(skill),
    packageRoot: `/root/node_modules/${name}`,
    kind: 'npm',
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

  it('matches by name only, so workspace:foo authorizes an npm-discovered foo (M1 baseline)', () => {
    const result = applySourcePolicy(
      { packages: [pkg('foo', ['x'])] },
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

describe('applySourcePolicy — permit-all and empty modes', () => {
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
