import { sourceIdentityKey } from '../types.js'
import { canonicalIntentLockfile, classifyLockfileHash } from './lockfile.js'
import type {
  IntentLockfileSkill,
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from './lockfile.js'

interface ChangedLockfileSkill {
  path: string
  lockedContentHash: string
  currentContentHash: string
}

interface ChangedLockfileSource {
  kind: IntentLockfileSource['kind']
  id: string
  addedSkills: Array<IntentLockfileSkill>
  removedSkills: Array<IntentLockfileSkill>
  changedSkills: Array<ChangedLockfileSkill>
}

export interface LockfileDiff {
  lockfile: 'missing' | 'found'
  addedSources: Array<IntentLockfileSource>
  removedSources: Array<IntentLockfileSource>
  changedSources: Array<ChangedLockfileSource>
  isClean: boolean
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function diffLockfileSources(
  currentSources: ReadonlyArray<IntentLockfileSource>,
  locked: ReadIntentLockfileResult,
): LockfileDiff {
  if (locked.status === 'missing') {
    return {
      lockfile: 'missing',
      addedSources: [],
      removedSources: [],
      changedSources: [],
      isClean: false,
    }
  }
  const current = canonicalIntentLockfile({
    lockfileVersion: 1,
    sources: [...currentSources],
  }).sources
  const currentByKey = new Map(
    current.map((source) => [sourceIdentityKey(source), source]),
  )
  const lockedByKey = new Map(
    locked.lockfile.sources.map((source) => [
      sourceIdentityKey(source),
      source,
    ]),
  )
  const addedSources = current.filter(
    (source) => !lockedByKey.has(sourceIdentityKey(source)),
  )
  const removedSources = locked.lockfile.sources.filter(
    (source) => !currentByKey.has(sourceIdentityKey(source)),
  )
  const changedSources: Array<ChangedLockfileSource> = []
  for (const lockedSource of locked.lockfile.sources) {
    const currentSource = currentByKey.get(sourceIdentityKey(lockedSource))
    if (!currentSource) continue
    const currentSkills = new Map(
      currentSource.skills.map((skill) => [skill.path, skill]),
    )
    const lockedSkills = new Map(
      lockedSource.skills.map((skill) => [skill.path, skill]),
    )
    const addedSkills = currentSource.skills.filter(
      (skill) => !lockedSkills.has(skill.path),
    )
    const removedSkills = lockedSource.skills.filter(
      (skill) => !currentSkills.has(skill.path),
    )
    const changedSkills = lockedSource.skills.flatMap((skill) => {
      const currentSkill = currentSkills.get(skill.path)
      if (
        !currentSkill ||
        classifyLockfileHash(currentSkill.contentHash, skill.contentHash) !==
          'changed'
      ) {
        return []
      }
      return [
        {
          path: skill.path,
          lockedContentHash: skill.contentHash,
          currentContentHash: currentSkill.contentHash,
        },
      ]
    })
    if (addedSkills.length || removedSkills.length || changedSkills.length) {
      changedSources.push({
        kind: currentSource.kind,
        id: currentSource.id,
        addedSkills,
        removedSkills,
        changedSkills,
      })
    }
  }
  changedSources.sort((a, b) =>
    compareStrings(sourceIdentityKey(a), sourceIdentityKey(b)),
  )
  return {
    lockfile: 'found',
    addedSources,
    removedSources,
    changedSources,
    isClean:
      !addedSources.length && !removedSources.length && !changedSources.length,
  }
}
