import { describe, expect, it } from 'vitest'
import { diffLockfileSources } from '../src/core/lockfile/lockfile-diff.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../src/core/lockfile/lockfile.js'

const source = (
  skills: IntentLockfileSource['skills'],
): IntentLockfileSource => ({ kind: 'npm', id: 'example', skills })

describe('diffLockfileSources', () => {
  it('distinguishes a missing lockfile', () => {
    expect(diffLockfileSources([], { status: 'missing' })).toMatchObject({
      lockfile: 'missing',
      isClean: false,
    })
  })

  it('diffs sources and individual skills independently regardless of ordering', () => {
    const locked: ReadIntentLockfileResult = {
      status: 'found' as const,
      lockfile: {
        lockfileVersion: 1 as const,
        sources: [
          source([
            { path: 'skills/first', contentHash: 'one' },
            { path: 'skills/second', contentHash: 'two' },
          ]),
          { kind: 'workspace', id: 'removed', skills: [] },
        ],
      },
    }
    const result = diffLockfileSources(
      [
        source([
          { path: 'skills/third', contentHash: 'three' },
          { path: 'skills/second', contentHash: 'two' },
          { path: 'skills/first', contentHash: 'changed' },
        ]),
        { kind: 'workspace', id: 'new', skills: [] },
      ],
      locked,
    )
    expect(result.addedSources).toEqual([
      { kind: 'workspace', id: 'new', skills: [] },
    ])
    expect(result.removedSources).toEqual([
      { kind: 'workspace', id: 'removed', skills: [] },
    ])
    expect(result.changedSources).toEqual([
      {
        kind: 'npm',
        id: 'example',
        addedSkills: [{ path: 'skills/third', contentHash: 'three' }],
        removedSkills: [],
        changedSkills: [
          {
            path: 'skills/first',
            lockedContentHash: 'one',
            currentContentHash: 'changed',
          },
        ],
      },
    ])
  })

  it('reports a removed skill without treating it as changed', () => {
    const locked: ReadIntentLockfileResult = {
      status: 'found',
      lockfile: {
        lockfileVersion: 1,
        sources: [
          source([
            { path: 'skills/first', contentHash: 'one' },
            { path: 'skills/removed', contentHash: 'old' },
          ]),
        ],
      },
    }

    expect(
      diffLockfileSources(
        [source([{ path: 'skills/first', contentHash: 'one' }])],
        locked,
      ).changedSources,
    ).toEqual([
      {
        kind: 'npm',
        id: 'example',
        addedSkills: [],
        removedSkills: [{ path: 'skills/removed', contentHash: 'old' }],
        changedSkills: [],
      },
    ])
  })
})
