import { join, resolve } from 'node:path'
import { diffLockfileSources } from '../../core/lockfile/lockfile-diff.js'
import { readIntentLockfile } from '../../core/lockfile/lockfile.js'
import { sourceIdentityKey } from '../../core/types.js'
import { scanInstallCandidateInventory } from './candidate-inventory.js'
import type { IntentLockfileSource } from '../../core/lockfile/lockfile.js'
import type {
  InstallCandidateInventory,
  InstallCandidateInventoryOptions,
} from './candidate-inventory.js'

type CandidateSource = InstallCandidateInventory['sources'][number]
type CandidateSkill = CandidateSource['skills'][number]
type CurrentSourceMetadata = Omit<CandidateSource, 'skills'>
type CurrentSkillMetadata = CandidateSkill

type NewReviewSkill = CurrentSkillMetadata & {
  status: 'new'
  eligible: boolean
}

type AcceptedReviewSkill = CurrentSkillMetadata & {
  status: 'accepted'
  eligible: boolean
}

type ChangedReviewSkill = CurrentSkillMetadata & {
  status: 'changed'
  lockedContentHash: string
  eligible: boolean
}

type RemovedReviewSkill = {
  status: 'removed'
  path: string
  lockedContentHash: string
}

type UnavailableReviewSkill = {
  status: 'unavailable'
  path: string
  lockedContentHash: string
}

type NewReviewSource = CurrentSourceMetadata & {
  status: 'new'
  eligible: boolean
  skills: Array<NewReviewSkill>
}

type AvailableReviewSource = CurrentSourceMetadata & {
  status: 'available'
  lockedObservedVersion: string
  versionChanged: boolean
  eligible: boolean
  skills: Array<
    | AcceptedReviewSkill
    | NewReviewSkill
    | ChangedReviewSkill
    | RemovedReviewSkill
  >
}

type UnavailableReviewSource = {
  status: 'unavailable'
  kind: IntentLockfileSource['kind']
  id: string
  lockedObservedVersion: string
  skills: Array<UnavailableReviewSkill>
}

type InstallReviewSource =
  NewReviewSource | AvailableReviewSource | UnavailableReviewSource

export type InstallReviewOptions = InstallCandidateInventoryOptions

export interface InstallReviewResult {
  packageManager: InstallCandidateInventory['packageManager']
  sources: Array<InstallReviewSource>
  warnings: InstallCandidateInventory['warnings']
  conflicts: InstallCandidateInventory['conflicts']
  readFs: InstallCandidateInventory['readFs']
  lockfile: 'missing' | 'found'
  contentIsClean: boolean
}

export function buildInstallReview(
  root: string,
  options: InstallReviewOptions = {},
): InstallReviewResult {
  const resolvedRoot = resolve(root)
  const inventory = scanInstallCandidateInventory(resolvedRoot, options)
  const locked = readIntentLockfile(join(resolvedRoot, 'intent.lock'))
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
  const diff = diffLockfileSources(currentSources, locked)
  const currentSourcesByKey = new Map(
    inventory.sources.map((source) => [sourceIdentityKey(source), source]),
  )

  const sources = diff.sources.map((sourceDiff): InstallReviewSource => {
    if (sourceDiff.status === 'unavailable') {
      return {
        status: 'unavailable',
        kind: sourceDiff.kind,
        id: sourceDiff.id,
        lockedObservedVersion: sourceDiff.lockedObservedVersion,
        skills: sourceDiff.skills.map((skill) => ({
          status: 'unavailable',
          path: skill.path,
          lockedContentHash: skill.lockedContentHash,
        })),
      }
    }

    const currentSource = currentSourcesByKey.get(
      sourceIdentityKey(sourceDiff),
    )!
    const { skills: currentSkills, ...currentMetadata } = currentSource
    const currentSkillsByPath = new Map(
      currentSkills.map((skill) => [skill.path, skill]),
    )

    if (sourceDiff.status === 'new') {
      return {
        status: 'new',
        ...currentMetadata,
        eligible: currentSource.permitted && !currentSource.excluded,
        skills: sourceDiff.skills.map((skillDiff) => {
          const currentSkill = currentSkillsByPath.get(skillDiff.path)!
          return {
            status: 'new',
            ...currentSkill,
            eligible: currentSkill.permitted && !currentSkill.excluded,
          }
        }),
      }
    }

    return {
      status: 'available',
      ...currentMetadata,
      lockedObservedVersion: sourceDiff.lockedObservedVersion,
      versionChanged:
        currentSource.observedVersion !== sourceDiff.lockedObservedVersion,
      eligible: currentSource.permitted && !currentSource.excluded,
      skills: sourceDiff.skills.map((skillDiff) => {
        if (skillDiff.status === 'removed') {
          return {
            status: 'removed',
            path: skillDiff.path,
            lockedContentHash: skillDiff.lockedContentHash,
          }
        }

        const currentSkill = currentSkillsByPath.get(skillDiff.path)!
        const eligible = currentSkill.permitted && !currentSkill.excluded
        if (skillDiff.status === 'changed') {
          return {
            status: 'changed',
            ...currentSkill,
            lockedContentHash: skillDiff.lockedContentHash,
            eligible,
          }
        }
        return { status: skillDiff.status, ...currentSkill, eligible }
      }),
    }
  })

  return {
    packageManager: inventory.packageManager,
    sources,
    warnings: inventory.warnings,
    conflicts: inventory.conflicts,
    readFs: inventory.readFs,
    lockfile: diff.lockfile,
    contentIsClean: diff.isClean,
  }
}
