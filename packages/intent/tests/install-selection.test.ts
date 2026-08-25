import { describe, expect, it } from 'vitest'
import {
  getInstallReviewSkillPath,
  getInstallReviewSourceIdentity,
} from '../src/commands/install/review.js'
import {
  acceptCurrentSkill,
  buildAcceptedLockfileProposal,
  revokeEmptySource,
  revokeLockedSkill,
} from '../src/commands/install/selection.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type {
  InstallReviewResult,
  InstallReviewSkill,
  InstallReviewSource,
} from '../src/commands/install/review.js'
import type { InstallReviewSelection } from '../src/commands/install/selection.js'
import type { IntentLockfile } from '../src/core/lockfile/lockfile.js'

function fakeHash(seed: string): string {
  return `sha256-${seed.repeat(64).slice(0, 64)}`
}

function currentSkill(
  path: string,
  contentHash: string,
  eligible = true,
): NonNullable<InstallReviewSkill['current']> {
  const name = path.slice('skills/'.length)
  return {
    name,
    description: name,
    use: `pkg#${name}`,
    path,
    contentHash,
    permitted: eligible,
    excluded: false,
  }
}

function acceptedSkill(
  path: string,
  contentHash: string,
): NonNullable<InstallReviewSkill['accepted']> {
  return { path, contentHash }
}

function currentSource(
  id: string,
  observedVersion = '2.0.0',
): NonNullable<InstallReviewSource['current']> {
  return {
    kind: 'npm',
    id,
    observedVersion,
    packageRoot: `/node_modules/${id}`,
    source: 'local',
    provenance: 'direct',
    permitted: true,
    excluded: false,
  }
}

function acceptedSource(
  id: string,
  observedVersion = '1.0.0',
): NonNullable<InstallReviewSource['accepted']> {
  return { kind: 'npm', id, observedVersion }
}

function review(
  sources: Array<InstallReviewSource>,
  lock?: IntentLockfile | null,
): InstallReviewResult {
  const derivedLock: IntentLockfile = {
    lockfileVersion: 1,
    sources: sources.flatMap((source) =>
      source.accepted === null
        ? []
        : [
            {
              ...source.accepted,
              skills: source.skills.flatMap((skill) =>
                skill.accepted === null ? [] : [skill.accepted],
              ),
            },
          ],
    ),
  }
  return {
    packageManager: 'npm',
    sources,
    warnings: [],
    conflicts: [],
    readFs: nodeReadFs,
    lock:
      lock === null
        ? { status: 'missing' }
        : { status: 'found', value: lock ?? derivedLock },
    contentIsClean: false,
  }
}

function findSource(result: InstallReviewResult, id: string) {
  const source = result.sources.find(
    (candidate) => getInstallReviewSourceIdentity(candidate).id === id,
  )
  if (source === undefined) throw new Error(`Missing source: ${id}`)
  return source
}

function findSkill(source: InstallReviewSource, path: string) {
  const skill = source.skills.find(
    (candidate) => getInstallReviewSkillPath(candidate) === path,
  )
  if (skill === undefined) throw new Error(`Missing skill: ${path}`)
  return skill
}

describe('buildAcceptedLockfileProposal', () => {
  it('preserves empty and prior locks without implicit acceptance or pruning', () => {
    const candidate = {
      current: currentSource('new'),
      accepted: null,
      skills: [
        {
          current: currentSkill('skills/new', fakeHash('1')),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    expect(
      buildAcceptedLockfileProposal(review([candidate], null), []),
    ).toEqual({ lockfileVersion: 1, sources: [] })
    expect(
      buildAcceptedLockfileProposal(
        review([candidate], { lockfileVersion: 1, sources: [] }),
        [],
      ),
    ).toEqual({ lockfileVersion: 1, sources: [] })

    const unavailable = {
      current: null,
      accepted: acceptedSource('unavailable', '3.0.0'),
      skills: [
        {
          current: null,
          accepted: acceptedSkill('skills/missing', fakeHash('2')),
        },
      ],
    } satisfies InstallReviewSource
    const ineligible = {
      current: currentSource('pkg'),
      accepted: acceptedSource('pkg'),
      skills: [
        {
          current: currentSkill('skills/kept', fakeHash('3'), false),
          accepted: acceptedSkill('skills/kept', fakeHash('3')),
        },
      ],
    } satisfies InstallReviewSource
    expect(
      buildAcceptedLockfileProposal(review([unavailable, ineligible]), []),
    ).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          skills: [{ path: 'skills/kept', contentHash: fakeHash('3') }],
        },
        {
          kind: 'npm',
          id: 'unavailable',
          observedVersion: '3.0.0',
          skills: [{ path: 'skills/missing', contentHash: fakeHash('2') }],
        },
      ],
    })
  })

  it('accepts only a selected eligible new skill', () => {
    const source = {
      current: currentSource('pkg', '1.0.0'),
      accepted: null,
      skills: [
        {
          current: currentSkill('skills/selected', fakeHash('4')),
          accepted: null,
        },
        {
          current: currentSkill('skills/withheld', fakeHash('5'), false),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    const result = review([source], null)
    const selection = acceptCurrentSkill(
      result,
      source,
      findSkill(source, 'skills/selected'),
    )
    expect(Object.isFrozen(selection)).toBe(true)
    expect(buildAcceptedLockfileProposal(result, [selection])).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          skills: [{ path: 'skills/selected', contentHash: fakeHash('4') }],
        },
      ],
    })
  })

  it('accepts a changed skill and preserves accepted siblings and removals', () => {
    const source = {
      current: currentSource('pkg'),
      accepted: acceptedSource('pkg'),
      skills: [
        {
          current: currentSkill('skills/changed', fakeHash('6')),
          accepted: acceptedSkill('skills/changed', fakeHash('7')),
        },
        {
          current: currentSkill('skills/unchanged', fakeHash('8')),
          accepted: acceptedSkill('skills/unchanged', fakeHash('8')),
        },
        {
          current: null,
          accepted: acceptedSkill('skills/removed', fakeHash('9')),
        },
      ],
    } satisfies InstallReviewSource
    const result = review([source])
    expect(
      buildAcceptedLockfileProposal(result, [
        acceptCurrentSkill(result, source, findSkill(source, 'skills/changed')),
      ]),
    ).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '2.0.0',
          skills: [
            { path: 'skills/changed', contentHash: fakeHash('6') },
            { path: 'skills/removed', contentHash: fakeHash('9') },
            { path: 'skills/unchanged', contentHash: fakeHash('8') },
          ],
        },
      ],
    })
  })

  it('revokes accepted, changed, removed, and unavailable relations', () => {
    const pkg = {
      current: currentSource('pkg'),
      accepted: acceptedSource('pkg'),
      skills: [
        {
          current: currentSkill('skills/accepted', fakeHash('a')),
          accepted: acceptedSkill('skills/accepted', fakeHash('a')),
        },
        {
          current: currentSkill('skills/changed', fakeHash('b')),
          accepted: acceptedSkill('skills/changed', fakeHash('c')),
        },
        {
          current: null,
          accepted: acceptedSkill('skills/removed', fakeHash('d')),
        },
        {
          current: currentSkill('skills/keep', fakeHash('e')),
          accepted: acceptedSkill('skills/keep', fakeHash('e')),
        },
      ],
    } satisfies InstallReviewSource
    const unavailable = {
      current: null,
      accepted: acceptedSource('unavailable'),
      skills: [
        {
          current: null,
          accepted: acceptedSkill('skills/gone', fakeHash('f')),
        },
      ],
    } satisfies InstallReviewSource
    const result = review([pkg, unavailable])
    const selections = [
      ...['accepted', 'changed', 'removed'].map((name) =>
        revokeLockedSkill(result, pkg, findSkill(pkg, `skills/${name}`)),
      ),
      revokeLockedSkill(
        result,
        unavailable,
        findSkill(unavailable, 'skills/gone'),
      ),
    ]
    expect(buildAcceptedLockfileProposal(result, selections)).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          skills: [{ path: 'skills/keep', contentHash: fakeHash('e') }],
        },
      ],
    })
  })

  it('drops a source after its final skill or empty-source revocation', () => {
    const final = {
      current: null,
      accepted: acceptedSource('final'),
      skills: [
        {
          current: null,
          accepted: acceptedSkill('skills/final', fakeHash('a')),
        },
      ],
    } satisfies InstallReviewSource
    const empty = {
      current: null,
      accepted: acceptedSource('empty'),
      skills: [],
    } satisfies InstallReviewSource
    const result = review([final, empty])
    const finalSelection = revokeLockedSkill(
      result,
      final,
      findSkill(final, 'skills/final'),
    )
    const emptySelection = revokeEmptySource(result, empty)
    expect(Object.isFrozen(finalSelection)).toBe(true)
    expect(Object.isFrozen(emptySelection)).toBe(true)
    expect(
      buildAcceptedLockfileProposal(result, [finalSelection, emptySelection]),
    ).toEqual({ lockfileVersion: 1, sources: [] })
  })

  it('rejects ineligible acceptance', () => {
    const source = {
      current: currentSource('pkg'),
      accepted: null,
      skills: [
        {
          current: currentSkill('skills/no', fakeHash('b'), false),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    const result = review([source], null)
    expect(() =>
      acceptCurrentSkill(result, source, findSkill(source, 'skills/no')),
    ).toThrow('Install review skill is not eligible: npm:pkg:skills/no')
  })

  it('rejects duplicate and conflicting targets', () => {
    const source = {
      current: currentSource('pkg'),
      accepted: acceptedSource('pkg'),
      skills: [
        {
          current: currentSkill('skills/changed', fakeHash('c')),
          accepted: acceptedSkill('skills/changed', fakeHash('d')),
        },
      ],
    } satisfies InstallReviewSource
    const result = review([source])
    const skill = findSkill(source, 'skills/changed')
    const accept = acceptCurrentSkill(result, source, skill)
    const revoke = revokeLockedSkill(result, source, skill)
    for (const selections of [
      [accept, accept],
      [accept, revoke],
    ]) {
      expect(() => buildAcceptedLockfileProposal(result, selections)).toThrow(
        'Duplicate install review selection: npm:pkg',
      )
    }
  })

  it('rejects foreign source and skill references', () => {
    const own = {
      current: currentSource('pkg'),
      accepted: null,
      skills: [
        {
          current: currentSkill('skills/own', fakeHash('d')),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    const foreign = {
      current: currentSource('foreign'),
      accepted: null,
      skills: [
        {
          current: currentSkill('skills/foreign', fakeHash('e')),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    const result = review([own], null)
    const foreignRelation = findSkill(foreign, 'skills/foreign')
    expect(() => acceptCurrentSkill(result, foreign, foreignRelation)).toThrow(
      'Install review source not found: npm:foreign',
    )
    expect(() => acceptCurrentSkill(result, own, foreignRelation)).toThrow(
      'Install review skill not found: npm:pkg:skills/foreign',
    )
    const foreignSource = {
      action: 'accept',
      source: foreign,
      skill: foreignRelation,
    } satisfies InstallReviewSelection
    const foreignSkill = {
      action: 'accept',
      source: own,
      skill: foreignRelation,
    } satisfies InstallReviewSelection
    expect(() =>
      buildAcceptedLockfileProposal(result, [foreignSource]),
    ).toThrow('Install review source not found: npm:foreign')
    expect(() => buildAcceptedLockfileProposal(result, [foreignSkill])).toThrow(
      'Install review skill not found: npm:pkg:skills/foreign',
    )
  })

  it('rejects illegal accept and revoke relations, including forged input', () => {
    const source = {
      current: currentSource('pkg'),
      accepted: acceptedSource('pkg'),
      skills: [
        {
          current: currentSkill('skills/same', fakeHash('f')),
          accepted: acceptedSkill('skills/same', fakeHash('f')),
        },
        {
          current: null,
          accepted: acceptedSkill('skills/removed', fakeHash('1')),
        },
        {
          current: currentSkill('skills/new', fakeHash('2')),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    const result = review([source])
    const unchanged = findSkill(source, 'skills/same')
    const removed = findSkill(source, 'skills/removed')
    const currentOnly = findSkill(source, 'skills/new')
    expect(() => acceptCurrentSkill(result, source, unchanged)).toThrow(
      'Install review skill is unchanged: npm:pkg:skills/same',
    )
    expect(() => acceptCurrentSkill(result, source, removed)).toThrow(
      'Install review skill cannot be accepted: npm:pkg:skills/removed',
    )
    expect(() => revokeLockedSkill(result, source, currentOnly)).toThrow(
      'Install review skill cannot be revoked: npm:pkg:skills/new',
    )
    const forged = [
      { action: 'accept', source, skill: unchanged },
      { action: 'accept', source, skill: removed },
      { action: 'revoke', source, skill: currentOnly },
    ] satisfies Array<InstallReviewSelection>
    for (const selection of forged) {
      expect(() => buildAcceptedLockfileProposal(result, [selection])).toThrow()
    }
  })

  it('adds a new skill to an accepted source and preserves sibling trust', () => {
    const source = {
      current: currentSource('pkg'),
      accepted: acceptedSource('pkg'),
      skills: [
        {
          current: currentSkill('skills/z-prior', fakeHash('3')),
          accepted: acceptedSkill('skills/z-prior', fakeHash('3')),
        },
        {
          current: currentSkill('skills/new', fakeHash('4')),
          accepted: null,
        },
      ],
    } satisfies InstallReviewSource
    const result = review([source])
    expect(
      buildAcceptedLockfileProposal(result, [
        acceptCurrentSkill(result, source, findSkill(source, 'skills/new')),
      ]),
    ).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '2.0.0',
          skills: [
            { path: 'skills/new', contentHash: fakeHash('4') },
            { path: 'skills/z-prior', contentHash: fakeHash('3') },
          ],
        },
      ],
    })
  })

  it('returns canonical order without mutating review input', () => {
    const z = {
      current: null,
      accepted: acceptedSource('z'),
      skills: [
        { current: null, accepted: acceptedSkill('skills/z', fakeHash('5')) },
        { current: null, accepted: acceptedSkill('skills/a', fakeHash('6')) },
      ],
    } satisfies InstallReviewSource
    const a = {
      current: null,
      accepted: acceptedSource('a'),
      skills: [
        { current: null, accepted: acceptedSkill('skills/b', fakeHash('7')) },
      ],
    } satisfies InstallReviewSource
    const result = review([z, a])
    expect(findSource(result, 'z')).toBe(z)
    expect(findSkill(z, 'skills/a').accepted?.path).toBe('skills/a')
    const before = structuredClone(result.lock)
    const proposal = buildAcceptedLockfileProposal(result, [])
    expect(proposal.sources.map((source) => source.id)).toEqual(['a', 'z'])
    expect(proposal.sources[1]?.skills.map((skill) => skill.path)).toEqual([
      'skills/a',
      'skills/z',
    ])
    expect(result.lock).toEqual(before)
  })
})
