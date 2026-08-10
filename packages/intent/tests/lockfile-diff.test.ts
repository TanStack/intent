import { describe, expect, it } from 'vitest'
import { diffLockfileSources } from '../src/core/lockfile/lockfile-diff.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../src/core/lockfile/lockfile.js'

const HASH_A = `sha256-${'a'.repeat(64)}`
const HASH_B = `sha256-${'b'.repeat(64)}`
const HASH_C = `sha256-${'c'.repeat(64)}`
const HASH_D = `sha256-${'d'.repeat(64)}`

function source(
  id = 'pkg',
  skills: ReadonlyArray<readonly [path: string, contentHash: string]> = [],
  options: {
    kind?: IntentLockfileSource['kind']
    observedVersion?: string
  } = {},
): IntentLockfileSource {
  return {
    kind: options.kind ?? 'npm',
    id,
    observedVersion: options.observedVersion ?? '1.0.0',
    skills: skills.map(([path, contentHash]) => ({ path, contentHash })),
  }
}

function found(sources: Array<IntentLockfileSource>): ReadIntentLockfileResult {
  return {
    status: 'found',
    lockfile: { lockfileVersion: 1, sources },
  }
}

describe('diffLockfileSources', () => {
  it('reports a missing lock with no current sources as not clean', () => {
    expect(diffLockfileSources([], { status: 'missing' })).toEqual({
      lockfile: 'missing',
      sources: [],
      isClean: false,
    })
  })

  it('reports every current source and skill as new when the lock is missing', () => {
    expect(
      diffLockfileSources(
        [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ path: 'skills/a', contentHash: HASH_A }],
          },
        ],
        { status: 'missing' },
      ),
    ).toEqual({
      lockfile: 'missing',
      sources: [
        {
          status: 'new',
          kind: 'npm',
          id: 'pkg',
          currentObservedVersion: '1.0.0',
          skills: [
            {
              status: 'new',
              path: 'skills/a',
              currentContentHash: HASH_A,
            },
          ],
        },
      ],
      isClean: false,
    })
  })

  it('reports a found empty lock and empty current state as clean', () => {
    expect(diffLockfileSources([], found([]))).toEqual({
      lockfile: 'found',
      sources: [],
      isClean: true,
    })
  })

  it('keeps accepted sources and skills in clean output', () => {
    const accepted = source('pkg', [
      ['skills/a', HASH_A],
      ['skills/b', HASH_B],
    ])

    expect(diffLockfileSources([accepted], found([accepted]))).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'available',
          kind: 'npm',
          id: 'pkg',
          lockedObservedVersion: '1.0.0',
          currentObservedVersion: '1.0.0',
          skills: [
            {
              status: 'accepted',
              path: 'skills/a',
              contentHash: HASH_A,
            },
            {
              status: 'accepted',
              path: 'skills/b',
              contentHash: HASH_B,
            },
          ],
        },
      ],
      isClean: true,
    })
  })

  it('reports both observed versions but keeps version-only changes clean', () => {
    const lockedSource = source('pkg', [['skills/a', HASH_A]], {
      observedVersion: '1.0.0',
    })
    const currentSource = source('pkg', [['skills/a', HASH_A]], {
      observedVersion: '2.0.0',
    })

    expect(diffLockfileSources([currentSource], found([lockedSource]))).toEqual(
      {
        lockfile: 'found',
        sources: [
          {
            status: 'available',
            kind: 'npm',
            id: 'pkg',
            lockedObservedVersion: '1.0.0',
            currentObservedVersion: '2.0.0',
            skills: [
              {
                status: 'accepted',
                path: 'skills/a',
                contentHash: HASH_A,
              },
            ],
          },
        ],
        isClean: true,
      },
    )
  })

  it('reports current-only sources and sibling skills as new', () => {
    const lockedSource = source('pkg', [['skills/a', HASH_A]])
    const currentSource = source('pkg', [
      ['skills/a', HASH_A],
      ['skills/b', HASH_B],
    ])

    expect(
      diffLockfileSources(
        [currentSource, source('empty')],
        found([lockedSource]),
      ),
    ).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'new',
          kind: 'npm',
          id: 'empty',
          currentObservedVersion: '1.0.0',
          skills: [],
        },
        {
          status: 'available',
          kind: 'npm',
          id: 'pkg',
          lockedObservedVersion: '1.0.0',
          currentObservedVersion: '1.0.0',
          skills: [
            {
              status: 'accepted',
              path: 'skills/a',
              contentHash: HASH_A,
            },
            {
              status: 'new',
              path: 'skills/b',
              currentContentHash: HASH_B,
            },
          ],
        },
      ],
      isClean: false,
    })
  })

  it('reports a changed skill while keeping an unchanged sibling accepted', () => {
    const lockedSource = source('pkg', [
      ['skills/a', HASH_A],
      ['skills/b', HASH_A],
    ])
    const currentSource = source('pkg', [
      ['skills/a', HASH_B],
      ['skills/b', HASH_A],
    ])

    expect(diffLockfileSources([currentSource], found([lockedSource]))).toEqual(
      {
        lockfile: 'found',
        sources: [
          {
            status: 'available',
            kind: 'npm',
            id: 'pkg',
            lockedObservedVersion: '1.0.0',
            currentObservedVersion: '1.0.0',
            skills: [
              {
                status: 'changed',
                path: 'skills/a',
                lockedContentHash: HASH_A,
                currentContentHash: HASH_B,
              },
              {
                status: 'accepted',
                path: 'skills/b',
                contentHash: HASH_A,
              },
            ],
          },
        ],
        isClean: false,
      },
    )
  })

  it('reports a locked-only skill as removed from an available source', () => {
    const lockedSource = source('pkg', [
      ['skills/a', HASH_A],
      ['skills/b', HASH_B],
    ])
    const currentSource = source('pkg', [['skills/a', HASH_A]])

    expect(diffLockfileSources([currentSource], found([lockedSource]))).toEqual(
      {
        lockfile: 'found',
        sources: [
          {
            status: 'available',
            kind: 'npm',
            id: 'pkg',
            lockedObservedVersion: '1.0.0',
            currentObservedVersion: '1.0.0',
            skills: [
              {
                status: 'accepted',
                path: 'skills/a',
                contentHash: HASH_A,
              },
              {
                status: 'removed',
                path: 'skills/b',
                lockedContentHash: HASH_B,
              },
            ],
          },
        ],
        isClean: false,
      },
    )
  })

  it('reports entire locked-only sources as unavailable, including zero-skill sources', () => {
    expect(
      diffLockfileSources(
        [],
        found([source('full', [['skills/a', HASH_A]]), source('empty')]),
      ),
    ).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'unavailable',
          kind: 'npm',
          id: 'empty',
          lockedObservedVersion: '1.0.0',
          skills: [],
        },
        {
          status: 'unavailable',
          kind: 'npm',
          id: 'full',
          lockedObservedVersion: '1.0.0',
          skills: [
            {
              status: 'unavailable',
              path: 'skills/a',
              lockedContentHash: HASH_A,
            },
          ],
        },
      ],
      isClean: false,
    })
  })

  it('keeps the same id under different kinds as unavailable and new sources', () => {
    const lockedSource = source('shared', [['skills/a', HASH_A]])
    const currentSource = source('shared', [['skills/b', HASH_B]], {
      kind: 'workspace',
      observedVersion: '',
    })

    expect(diffLockfileSources([currentSource], found([lockedSource]))).toEqual(
      {
        lockfile: 'found',
        sources: [
          {
            status: 'unavailable',
            kind: 'npm',
            id: 'shared',
            lockedObservedVersion: '1.0.0',
            skills: [
              {
                status: 'unavailable',
                path: 'skills/a',
                lockedContentHash: HASH_A,
              },
            ],
          },
          {
            status: 'new',
            kind: 'workspace',
            id: 'shared',
            currentObservedVersion: '',
            skills: [
              {
                status: 'new',
                path: 'skills/b',
                currentContentHash: HASH_B,
              },
            ],
          },
        ],
        isClean: false,
      },
    )
  })

  it('returns mixed source and skill statuses with exact hash field shapes', () => {
    const currentAvailable = source('middle', [
      ['skills/c', HASH_C],
      ['skills/b', HASH_B],
      ['skills/a', HASH_A],
    ])
    const lockedAvailable = source('middle', [
      ['skills/d', HASH_D],
      ['skills/c', HASH_B],
      ['skills/a', HASH_A],
    ])

    expect(
      diffLockfileSources(
        [source('z-current'), currentAvailable],
        found([lockedAvailable, source('A-locked', [['skills/x', HASH_D]])]),
      ),
    ).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'unavailable',
          kind: 'npm',
          id: 'A-locked',
          lockedObservedVersion: '1.0.0',
          skills: [
            {
              status: 'unavailable',
              path: 'skills/x',
              lockedContentHash: HASH_D,
            },
          ],
        },
        {
          status: 'available',
          kind: 'npm',
          id: 'middle',
          lockedObservedVersion: '1.0.0',
          currentObservedVersion: '1.0.0',
          skills: [
            {
              status: 'accepted',
              path: 'skills/a',
              contentHash: HASH_A,
            },
            {
              status: 'new',
              path: 'skills/b',
              currentContentHash: HASH_B,
            },
            {
              status: 'changed',
              path: 'skills/c',
              lockedContentHash: HASH_B,
              currentContentHash: HASH_C,
            },
            {
              status: 'removed',
              path: 'skills/d',
              lockedContentHash: HASH_D,
            },
          ],
        },
        {
          status: 'new',
          kind: 'npm',
          id: 'z-current',
          currentObservedVersion: '1.0.0',
          skills: [],
        },
      ],
      isClean: false,
    })
  })

  it('canonicalizes reverse input ordering without mutating either input', () => {
    const current = [
      source('zeta', [
        ['skills/z', HASH_D],
        ['skills/a', HASH_C],
      ]),
      source('Alpha', [
        ['skills/b', HASH_B],
        ['skills/a', HASH_A],
      ]),
    ]
    const locked = [
      source('Alpha', [
        ['skills/a', HASH_A],
        ['skills/b', HASH_B],
      ]),
      source('zeta', [
        ['skills/a', HASH_C],
        ['skills/z', HASH_D],
      ]),
    ]
    const currentOriginal = structuredClone(current)
    const lockedOriginal = structuredClone(locked)
    const reversedCurrent = structuredClone(current).reverse()
    const reversedLocked = structuredClone(locked).reverse()
    for (const reversedSource of reversedCurrent) {
      reversedSource.skills.reverse()
    }
    for (const reversedSource of reversedLocked) {
      reversedSource.skills.reverse()
    }

    expect(diffLockfileSources(current, found(locked))).toEqual(
      diffLockfileSources(reversedCurrent, found(reversedLocked)),
    )
    expect(current).toEqual(currentOriginal)
    expect(locked).toEqual(lockedOriginal)
  })

  it('rejects runtime duplicate sources and skill paths through canonical validation', () => {
    const duplicateSource = source('duplicate')
    const duplicatePath = source('paths', [
      ['skills/a', HASH_A],
      ['skills/a', HASH_B],
    ])

    expect(() =>
      diffLockfileSources([duplicateSource, structuredClone(duplicateSource)], {
        status: 'missing',
      }),
    ).toThrow('Duplicate source: npm:duplicate')
    expect(() =>
      diffLockfileSources([duplicatePath], { status: 'missing' }),
    ).toThrow('Duplicate skill path: skills/a')
    expect(() =>
      diffLockfileSources(
        [],
        found([duplicateSource, structuredClone(duplicateSource)]),
      ),
    ).toThrow('Duplicate source: npm:duplicate')
    expect(() => diffLockfileSources([], found([duplicatePath]))).toThrow(
      'Duplicate skill path: skills/a',
    )
  })

  it('reports matching zero-skill sources as available and clean', () => {
    const empty = source('empty')

    expect(diffLockfileSources([empty], found([empty]))).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'available',
          kind: 'npm',
          id: 'empty',
          lockedObservedVersion: '1.0.0',
          currentObservedVersion: '1.0.0',
          skills: [],
        },
      ],
      isClean: true,
    })
  })

  it('reports current-only and locked-only zero-skill sources as not clean', () => {
    const empty = source('empty')

    expect(diffLockfileSources([empty], found([]))).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'new',
          kind: 'npm',
          id: 'empty',
          currentObservedVersion: '1.0.0',
          skills: [],
        },
      ],
      isClean: false,
    })
    expect(diffLockfileSources([], found([empty]))).toEqual({
      lockfile: 'found',
      sources: [
        {
          status: 'unavailable',
          kind: 'npm',
          id: 'empty',
          lockedObservedVersion: '1.0.0',
          skills: [],
        },
      ],
      isClean: false,
    })
  })
})
