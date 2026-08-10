import { sourceIdentityKey } from '../types.js'
import { canonicalIntentLockfile } from './lockfile.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from './lockfile.js'

export type LockfileSkillDiff =
  | { status: 'accepted'; path: string; contentHash: string }
  | { status: 'new'; path: string; currentContentHash: string }
  | {
      status: 'changed'
      path: string
      lockedContentHash: string
      currentContentHash: string
    }
  | { status: 'removed'; path: string; lockedContentHash: string }
  | { status: 'unavailable'; path: string; lockedContentHash: string }

type NewSkillDiff = Extract<LockfileSkillDiff, { status: 'new' }>
type UnavailableSkillDiff = Extract<
  LockfileSkillDiff,
  { status: 'unavailable' }
>
type AvailableSkillDiff = Exclude<LockfileSkillDiff, UnavailableSkillDiff>

export type LockfileSourceDiff =
  | {
      status: 'available'
      kind: 'npm' | 'workspace'
      id: string
      lockedObservedVersion: string
      currentObservedVersion: string
      skills: Array<AvailableSkillDiff>
    }
  | {
      status: 'new'
      kind: 'npm' | 'workspace'
      id: string
      currentObservedVersion: string
      skills: Array<NewSkillDiff>
    }
  | {
      status: 'unavailable'
      kind: 'npm' | 'workspace'
      id: string
      lockedObservedVersion: string
      skills: Array<UnavailableSkillDiff>
    }

export interface LockfileDiff {
  lockfile: 'missing' | 'found'
  sources: Array<LockfileSourceDiff>
  isClean: boolean
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function diffLockfileSources(
  currentSources: ReadonlyArray<IntentLockfileSource>,
  locked: ReadIntentLockfileResult,
): LockfileDiff {
  const current = canonicalIntentLockfile({
    lockfileVersion: 1,
    sources: [...currentSources],
  })

  if (locked.status === 'missing') {
    return {
      lockfile: 'missing',
      sources: current.sources.map((source) => ({
        status: 'new',
        kind: source.kind,
        id: source.id,
        currentObservedVersion: source.observedVersion,
        skills: source.skills.map((skill) => ({
          status: 'new',
          path: skill.path,
          currentContentHash: skill.contentHash,
        })),
      })),
      isClean: false,
    }
  }

  const lockedCanonical = canonicalIntentLockfile({
    lockfileVersion: 1,
    sources: [...locked.lockfile.sources],
  })

  const currentByKey = new Map(
    current.sources.map((source) => [sourceIdentityKey(source), source]),
  )
  const lockedByKey = new Map(
    lockedCanonical.sources.map((source) => [
      sourceIdentityKey(source),
      source,
    ]),
  )
  const sourceKeys = [
    ...new Set([...currentByKey.keys(), ...lockedByKey.keys()]),
  ].sort(compareCodeUnits)
  const sources: Array<LockfileSourceDiff> = []
  let isClean = true

  for (const sourceKey of sourceKeys) {
    const currentSource = currentByKey.get(sourceKey)
    const lockedSource = lockedByKey.get(sourceKey)
    if (currentSource !== undefined && lockedSource === undefined) {
      sources.push({
        status: 'new',
        kind: currentSource.kind,
        id: currentSource.id,
        currentObservedVersion: currentSource.observedVersion,
        skills: currentSource.skills.map((skill) => ({
          status: 'new',
          path: skill.path,
          currentContentHash: skill.contentHash,
        })),
      })
      isClean = false
      continue
    }
    if (currentSource === undefined && lockedSource !== undefined) {
      sources.push({
        status: 'unavailable',
        kind: lockedSource.kind,
        id: lockedSource.id,
        lockedObservedVersion: lockedSource.observedVersion,
        skills: lockedSource.skills.map((skill) => ({
          status: 'unavailable',
          path: skill.path,
          lockedContentHash: skill.contentHash,
        })),
      })
      isClean = false
      continue
    }
    if (currentSource === undefined || lockedSource === undefined) {
      isClean = false
      continue
    }

    const currentSkillsByPath = new Map(
      currentSource.skills.map((skill) => [skill.path, skill]),
    )
    const lockedSkillsByPath = new Map(
      lockedSource.skills.map((skill) => [skill.path, skill]),
    )
    const skillPaths = [
      ...new Set([...currentSkillsByPath.keys(), ...lockedSkillsByPath.keys()]),
    ].sort(compareCodeUnits)
    const skills: Array<AvailableSkillDiff> = []

    for (const skillPath of skillPaths) {
      const currentSkill = currentSkillsByPath.get(skillPath)
      const lockedSkill = lockedSkillsByPath.get(skillPath)
      if (currentSkill !== undefined && lockedSkill === undefined) {
        skills.push({
          status: 'new',
          path: skillPath,
          currentContentHash: currentSkill.contentHash,
        })
        isClean = false
        continue
      }
      if (currentSkill === undefined && lockedSkill !== undefined) {
        skills.push({
          status: 'removed',
          path: skillPath,
          lockedContentHash: lockedSkill.contentHash,
        })
        isClean = false
        continue
      }
      if (currentSkill === undefined || lockedSkill === undefined) {
        isClean = false
        continue
      }
      if (currentSkill.contentHash !== lockedSkill.contentHash) {
        skills.push({
          status: 'changed',
          path: skillPath,
          lockedContentHash: lockedSkill.contentHash,
          currentContentHash: currentSkill.contentHash,
        })
        isClean = false
        continue
      }
      skills.push({
        status: 'accepted',
        path: skillPath,
        contentHash: currentSkill.contentHash,
      })
    }

    sources.push({
      status: 'available',
      kind: currentSource.kind,
      id: currentSource.id,
      lockedObservedVersion: lockedSource.observedVersion,
      currentObservedVersion: currentSource.observedVersion,
      skills,
    })
  }

  return { lockfile: 'found', sources, isClean }
}
