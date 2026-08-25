import { join, resolve } from 'node:path'
import { diffLockfileSources } from '../../core/lockfile/lockfile-diff.js'
import {
  canonicalIntentLockfile,
  readIntentLockfile,
} from '../../core/lockfile/lockfile.js'
import { sourceIdentityKey } from '../../core/types.js'
import { scanInstallCandidateInventory } from './candidate-inventory.js'
import type {
  IntentLockfile,
  IntentLockfileSource,
} from '../../core/lockfile/lockfile.js'
import type {
  InstallCandidateInventory,
  InstallCandidateInventoryOptions,
} from './candidate-inventory.js'
import type { SourceIdentity } from '../../core/types.js'

type InventorySource = InstallCandidateInventory['sources'][number]
type CurrentSource = Omit<InventorySource, 'skills'>
type AcceptedSource = Omit<IntentLockfileSource, 'skills'>
type CurrentSkill = InventorySource['skills'][number]
type AcceptedSkill = IntentLockfileSource['skills'][number]

type CurrentOnly<Current> = { current: Current; accepted: null }
type Both<Current, Accepted> = { current: Current; accepted: Accepted }
type AcceptedOnly<Accepted> = { current: null; accepted: Accepted }
type Relation<Current, Accepted> =
  | CurrentOnly<Current>
  | Both<Current, Accepted>
  | AcceptedOnly<Accepted>

export type InstallReviewSkill = Relation<CurrentSkill, AcceptedSkill>

export type InstallReviewSource =
  | (CurrentOnly<CurrentSource> & {
      skills: Array<CurrentOnly<CurrentSkill>>
    })
  | (Both<CurrentSource, AcceptedSource> & {
      skills: Array<InstallReviewSkill>
    })
  | (AcceptedOnly<AcceptedSource> & {
      skills: Array<AcceptedOnly<AcceptedSkill>>
    })

export type InstallReviewOptions = InstallCandidateInventoryOptions

export type InstallReviewLock =
  | { status: 'missing' }
  | { status: 'found'; value: IntentLockfile }

export interface InstallReviewResult {
  packageManager: InstallCandidateInventory['packageManager']
  sources: Array<InstallReviewSource>
  warnings: InstallCandidateInventory['warnings']
  conflicts: InstallCandidateInventory['conflicts']
  readFs: InstallCandidateInventory['readFs']
  lock: InstallReviewLock
  contentIsClean: boolean
}

export function getInstallReviewSourceStatus(
  source: InstallReviewSource,
): 'new' | 'available' | 'unavailable' {
  if (source.current === null) return 'unavailable'
  return source.accepted === null ? 'new' : 'available'
}

export function getInstallReviewSkillStatus(
  source: InstallReviewSource,
  skill: InstallReviewSkill,
): 'new' | 'accepted' | 'changed' | 'removed' | 'unavailable' {
  if (skill.current === null) {
    return source.current === null ? 'unavailable' : 'removed'
  }
  if (skill.accepted === null) return 'new'
  return skill.current.contentHash === skill.accepted.contentHash
    ? 'accepted'
    : 'changed'
}

export function isInstallReviewSkillEligible(
  skill: InstallReviewSkill,
): boolean {
  return (
    skill.current !== null &&
    skill.current.permitted &&
    !skill.current.excluded
  )
}

export function getInstallReviewSourceIdentity(
  source: InstallReviewSource,
): SourceIdentity {
  const value = source.current ?? source.accepted
  return { kind: value.kind, id: value.id }
}

export function getInstallReviewSkillPath(skill: InstallReviewSkill): string {
  return (skill.current ?? skill.accepted).path
}

function requireMapValue<Key, Value>(
  values: ReadonlyMap<Key, Value>,
  key: Key,
  subject: string,
): Value {
  const value = values.get(key)
  if (value === undefined) {
    throw new Error(`Install review invariant failed: missing ${subject}`)
  }
  return value
}

export function buildInstallReview(
  root: string,
  options: InstallReviewOptions = {},
): InstallReviewResult {
  const resolvedRoot = resolve(root)
  const inventory = scanInstallCandidateInventory(resolvedRoot, options)
  const locked = readIntentLockfile(join(resolvedRoot, 'intent.lock'))
  const lock: InstallReviewLock =
    locked.status === 'found'
      ? {
          status: 'found' as const,
          value: canonicalIntentLockfile(locked.lockfile),
        }
      : locked
  const currentSources: Array<IntentLockfileSource> = inventory.sources.map(
    (source) => ({
      kind: source.kind,
      id: source.id,
      observedVersion: source.observedVersion,
      skills: source.skills.map((skill) => ({
        path: skill.path,
        contentHash: skill.contentHash,
      })),
    }),
  )
  const diff = diffLockfileSources(
    currentSources,
    lock.status === 'found'
      ? { status: 'found', lockfile: lock.value }
      : { status: 'missing' },
  )
  const currentSourcesByKey = new Map(
    inventory.sources.map((source) => [sourceIdentityKey(source), source]),
  )
  const acceptedSourcesByKey = new Map(
    (lock.status === 'found' ? lock.value.sources : []).map((source) => [
      sourceIdentityKey(source),
      source,
    ]),
  )

  const sources = diff.sources.map((sourceDiff): InstallReviewSource => {
    const sourceKey = sourceIdentityKey(sourceDiff)

    if (sourceDiff.status === 'unavailable') {
      const acceptedSource = requireMapValue(
        acceptedSourcesByKey,
        sourceKey,
        `accepted source ${sourceDiff.kind}:${sourceDiff.id}`,
      )
      const { skills: acceptedSkills, ...accepted } = acceptedSource
      const acceptedSkillsByPath = new Map(
        acceptedSkills.map((skill) => [skill.path, skill]),
      )
      return {
        current: null,
        accepted,
        skills: sourceDiff.skills.map((skill) => ({
          current: null,
          accepted: requireMapValue(
            acceptedSkillsByPath,
            skill.path,
            `accepted skill ${sourceDiff.kind}:${sourceDiff.id}:${skill.path}`,
          ),
        })),
      }
    }

    const currentSource = requireMapValue(
      currentSourcesByKey,
      sourceKey,
      `current source ${sourceDiff.kind}:${sourceDiff.id}`,
    )
    const { skills: currentSkills, ...current } = currentSource
    const currentSkillsByPath = new Map(
      currentSkills.map((skill) => [skill.path, skill]),
    )

    if (sourceDiff.status === 'new') {
      return {
        current,
        accepted: null,
        skills: sourceDiff.skills.map((skillDiff) => {
          return {
            current: requireMapValue(
              currentSkillsByPath,
              skillDiff.path,
              `current skill ${sourceDiff.kind}:${sourceDiff.id}:${skillDiff.path}`,
            ),
            accepted: null,
          }
        }),
      }
    }

    const acceptedSource = requireMapValue(
      acceptedSourcesByKey,
      sourceKey,
      `accepted source ${sourceDiff.kind}:${sourceDiff.id}`,
    )
    const { skills: acceptedSkills, ...accepted } = acceptedSource
    const acceptedSkillsByPath = new Map(
      acceptedSkills.map((skill) => [skill.path, skill]),
    )

    return {
      current,
      accepted,
      skills: sourceDiff.skills.map((skillDiff) => {
        if (skillDiff.status === 'removed') {
          return {
            current: null,
            accepted: requireMapValue(
              acceptedSkillsByPath,
              skillDiff.path,
              `accepted skill ${sourceDiff.kind}:${sourceDiff.id}:${skillDiff.path}`,
            ),
          }
        }

        if (skillDiff.status === 'new') {
          return {
            current: requireMapValue(
              currentSkillsByPath,
              skillDiff.path,
              `current skill ${sourceDiff.kind}:${sourceDiff.id}:${skillDiff.path}`,
            ),
            accepted: null,
          }
        }

        return {
          current: requireMapValue(
            currentSkillsByPath,
            skillDiff.path,
            `current skill ${sourceDiff.kind}:${sourceDiff.id}:${skillDiff.path}`,
          ),
          accepted: requireMapValue(
            acceptedSkillsByPath,
            skillDiff.path,
            `accepted skill ${sourceDiff.kind}:${sourceDiff.id}:${skillDiff.path}`,
          ),
        }
      }),
    }
  })

  return {
    packageManager: inventory.packageManager,
    sources,
    warnings: inventory.warnings,
    conflicts: inventory.conflicts,
    readFs: inventory.readFs,
    lock,
    contentIsClean: diff.isClean,
  }
}
