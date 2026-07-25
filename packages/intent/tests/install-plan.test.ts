import { describe, expect, it } from 'vitest'
import {
  buildInstallDeltaInventory,
  buildSkillSelectionPlan,
  summarizeInstallDeltaInventory,
} from '../src/commands/install/plan.js'
import type {
  InventoryLockStatus,
  InventoryPolicyStatus,
} from '../src/commands/install/plan.js'
import type { IntentLockfileSource } from '../src/core/lockfile/lockfile.js'
import type { IntentPackage } from '../src/shared/types.js'

function pkg(
  name: string,
  skills: Array<string>,
  kind: IntentPackage['kind'] = 'npm',
): IntentPackage {
  return {
    name,
    version: '1.0.0',
    kind,
    source: 'local',
    packageRoot: name,
    intent: { version: 1, repo: '', docs: '' },
    skills: skills.map((name) => ({
      name,
      path: `skills/${name}/SKILL.md`,
      description: '',
    })),
  }
}

const discovered = [
  pkg('@other/core', ['second']),
  pkg('@tanstack/query', ['zeta', 'alpha']),
  pkg('workspace-query', ['local'], 'workspace'),
]

describe('installer selection planning', () => {
  it('uses exact discovered source identities for all-found', () => {
    expect(
      buildSkillSelectionPlan(discovered, { mode: 'all-found' }),
    ).toMatchObject({
      skills: ['@other/core', '@tanstack/query', 'workspace:workspace-query'],
      exclude: [],
    })
  })

  it('adds explicit exclusions for scope nonmatches', () => {
    const plan = buildSkillSelectionPlan(discovered, {
      mode: 'scope',
      scope: '@tanstack/*',
    })
    expect(plan.skills).toEqual(['@tanstack/*'])
    expect(plan.exclude).toEqual(['@other/core', 'workspace-query'])
    expect(plan.packages.flatMap((entry) => entry.skills)).toEqual([
      { id: '@other/core#second', status: 'excluded' },
      { id: '@tanstack/query#alpha', status: 'enabled' },
      { id: '@tanstack/query#zeta', status: 'enabled' },
      { id: 'workspace:workspace-query#local', status: 'excluded' },
    ])
  })

  it('allows checked skills and excludes unchecked packages for individual selection', () => {
    const plan = buildSkillSelectionPlan(discovered, {
      mode: 'individual',
      enabled: ['@tanstack/query#alpha'],
    })
    expect(plan.skills).toEqual(['@tanstack/query#alpha'])
    expect(plan.exclude).toEqual(['@other/core', 'workspace-query'])
  })

  it('writes a bare package exclusion when no skills are selected', () => {
    const plan = buildSkillSelectionPlan([pkg('disabled', ['one', 'two'])], {
      mode: 'individual',
      enabled: [],
    })

    expect(plan.skills).toEqual([])
    expect(plan.exclude).toEqual(['disabled'])
  })

  it('rejects malformed, duplicate, and unknown individual selections', () => {
    expect(() =>
      buildSkillSelectionPlan(discovered, {
        mode: 'individual',
        enabled: ['not-an-id'],
      }),
    ).toThrow('Unknown')
    expect(() =>
      buildSkillSelectionPlan(discovered, {
        mode: 'individual',
        enabled: ['@tanstack/query#alpha', '@tanstack/query#alpha'],
      }),
    ).toThrow('Duplicate')
  })

  it('rejects a selection whose exclusion would hide an enabled skill', () => {
    const sameName = [
      pkg('shared', ['npm-skill']),
      pkg('shared', ['workspace-skill'], 'workspace'),
    ]
    expect(
      buildSkillSelectionPlan(sameName, { mode: 'all-found' }).skills,
    ).toEqual(['shared', 'workspace:shared'])
    expect(() =>
      buildSkillSelectionPlan(sameName, {
        mode: 'individual',
        enabled: ['workspace:shared#workspace-skill'],
      }),
    ).toThrow('would also hide "workspace:shared#workspace-skill"')
  })

  it('writes kind-aware skill allows when both kinds select a subset', () => {
    const sameName = [
      pkg('shared', ['keep', 'drop']),
      pkg('shared', ['keep', 'drop'], 'workspace'),
    ]
    const plan = buildSkillSelectionPlan(sameName, {
      mode: 'individual',
      enabled: ['shared#keep', 'workspace:shared#keep'],
    })

    expect(plan.skills).toEqual(['shared#keep', 'workspace:shared#keep'])
    expect(plan.exclude).toEqual([])
  })

  it('writes a shared package exclusion when both kinds are fully disabled', () => {
    const sameName = [
      pkg('shared', ['one']),
      pkg('shared', ['two'], 'workspace'),
      pkg('other', ['keep']),
    ]
    const plan = buildSkillSelectionPlan(sameName, {
      mode: 'individual',
      enabled: ['other#keep'],
    })

    expect(plan.skills).toEqual(['other'])
    expect(plan.exclude).toEqual(['shared'])
  })

  it('uses kind-aware workspace grammar for partial skill allows', () => {
    const plan = buildSkillSelectionPlan(
      [pkg('workspace-only', ['enabled', 'excluded'], 'workspace')],
      {
        mode: 'individual',
        enabled: ['workspace:workspace-only#enabled'],
      },
    )

    expect(plan.skills).toEqual(['workspace:workspace-only#enabled'])
    expect(plan.exclude).toEqual([])
  })

  it('rejects duplicate discovered sources and skills', () => {
    expect(() =>
      buildSkillSelectionPlan(
        [pkg('duplicate', ['one']), pkg('duplicate', ['two'])],
        {
          mode: 'all-found',
        },
      ),
    ).toThrow('Duplicate discovered source')
    expect(() =>
      buildSkillSelectionPlan([pkg('duplicate', ['one', 'one'])], {
        mode: 'all-found',
      }),
    ).toThrow('Duplicate discovered skill')
  })
})

describe('installer delta inventory', () => {
  it('summarizes pending, new, changed, and removed entries', () => {
    expect(
      summarizeInstallDeltaInventory({
        packages: [
          {
            name: 'pkg',
            kind: 'npm',
            skills: [
              { id: 'pkg#pending', policy: 'pending', lock: null },
              { id: 'pkg#new', policy: 'enabled', lock: 'new' },
              { id: 'pkg#changed', policy: 'enabled', lock: 'changed' },
              { id: 'pkg#accepted', policy: 'enabled', lock: 'accepted' },
            ],
          },
        ],
        removed: [{ kind: 'npm', id: 'gone', path: null }],
      }),
    ).toEqual({
      newDependencies: [{ name: 'pkg', skillCount: 1 }],
      newSkills: [{ name: 'pkg', skillCount: 1 }],
      changed: [{ name: 'pkg', skillCount: 1 }],
      removed: 1,
    })
  })

  it('classifies changed skills independently and reports removed lock entries', () => {
    const accepted: InventoryLockStatus = 'accepted'
    const enabled: InventoryPolicyStatus = 'enabled'
    expect([enabled, accepted]).toEqual(['enabled', 'accepted'])
    const packages = [pkg('pkg', ['alpha', 'beta'])]
    const current: Array<IntentLockfileSource> = [
      {
        kind: 'npm',
        id: 'pkg',
        skills: [
          { path: 'skills/alpha', contentHash: 'changed' },
          { path: 'skills/beta', contentHash: 'accepted' },
        ],
      },
    ]
    const inventory = buildInstallDeltaInventory(
      packages,
      current,
      {
        status: 'found',
        lockfile: {
          lockfileVersion: 1,
          sources: [
            {
              kind: 'npm',
              id: 'pkg',
              skills: [
                { path: 'skills/alpha', contentHash: 'old' },
                { path: 'skills/beta', contentHash: 'accepted' },
                { path: 'skills/removed', contentHash: 'removed' },
              ],
            },
            {
              kind: 'workspace',
              id: 'gone',
              skills: [{ path: 'skills/old', contentHash: 'removed' }],
            },
          ],
        },
      },
      { skills: ['pkg'], exclude: [] },
    )
    expect(inventory.packages[0]!.skills).toEqual([
      { id: 'pkg#alpha', policy: 'enabled', lock: 'changed' },
      { id: 'pkg#beta', policy: 'enabled', lock: 'accepted' },
    ])
    expect(inventory.removed).toEqual([
      { kind: 'npm', id: 'pkg', path: 'skills/removed' },
      { kind: 'workspace', id: 'gone', path: null },
    ])
  })

  it('marks enabled sources as new without a lock and leaves pending policy unaccepted', () => {
    const inventory = buildInstallDeltaInventory(
      [pkg('a', ['one']), pkg('b', ['two'])],
      [
        {
          kind: 'npm',
          id: 'a',
          skills: [{ path: 'skills/one', contentHash: 'a' }],
        },
        {
          kind: 'npm',
          id: 'b',
          skills: [{ path: 'skills/two', contentHash: 'b' }],
        },
      ],
      { status: 'missing' },
      { skills: ['a'], exclude: [] },
    )
    expect(inventory.packages.map((entry) => entry.skills[0])).toEqual([
      { id: 'a#one', policy: 'enabled', lock: 'new' },
      { id: 'b#two', policy: 'pending', lock: null },
    ])
  })

  it('marks a skill outside a skill-level allow entry as pending', () => {
    const inventory = buildInstallDeltaInventory(
      [pkg('pkg', ['alpha', 'beta'])],
      [],
      { status: 'missing' },
      { skills: ['pkg#alpha'], exclude: [] },
    )

    expect(inventory.packages[0]!.skills).toEqual([
      { id: 'pkg#alpha', policy: 'enabled', lock: 'new' },
      { id: 'pkg#beta', policy: 'pending', lock: null },
    ])
  })

  it('records a declined package as excluded rather than pending', () => {
    const discovered = [pkg('keep', ['one']), pkg('decline', ['two'])]
    const plan = buildSkillSelectionPlan(discovered, {
      mode: 'individual',
      enabled: ['keep#one'],
    })
    const inventory = buildInstallDeltaInventory(
      discovered,
      [],
      { status: 'missing' },
      { skills: plan.skills, exclude: plan.exclude },
    )
    const policies = new Map(
      inventory.packages.flatMap((entry) =>
        entry.skills.map((skill) => [skill.id, skill.policy]),
      ),
    )

    expect(policies.get('keep#one')).toBe('enabled')
    expect(policies.get('decline#two')).toBe('excluded')
  })
})
