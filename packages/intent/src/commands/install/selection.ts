import { canonicalIntentLockfile } from '../../core/lockfile/lockfile.js'
import { sourceIdentityKey } from '../../core/types.js'
import type { IntentLockfile } from '../../core/lockfile/lockfile.js'
import {
  getInstallReviewSkillPath,
  getInstallReviewSourceIdentity,
  isInstallReviewSkillEligible,
} from './review.js'
import type { InstallReviewResult } from './review.js'

type ReviewSource = InstallReviewResult['sources'][number]
type ReviewSkill = ReviewSource['skills'][number]

export type InstallReviewSelection = Readonly<
  | { action: 'accept'; source: ReviewSource; skill: ReviewSkill }
  | { action: 'revoke'; source: ReviewSource; skill: ReviewSkill | null }
>

function requireSource(
  review: InstallReviewResult,
  source: ReviewSource,
): void {
  if (review.sources.includes(source)) return
  throw new Error(`Install review source not found: ${sourceLabel(source)}`)
}

function requireSkill(source: ReviewSource, skill: ReviewSkill): void {
  if (source.skills.some((candidate) => candidate === skill)) return
  throw new Error(
    `Install review skill not found: ${skillLabel(source, skill)}`,
  )
}

function sourceLabel(source: ReviewSource): string {
  const { kind, id } = getInstallReviewSourceIdentity(source)
  return `${kind}:${id}`
}

function skillLabel(source: ReviewSource, skill: ReviewSkill): string {
  return `${sourceLabel(source)}:${getInstallReviewSkillPath(skill)}`
}

function reject(reason: string, source: ReviewSource, skill?: ReviewSkill): never {
  const label = skill === undefined ? sourceLabel(source) : skillLabel(source, skill)
  throw new Error(`Install review ${reason}: ${label}`)
}

export function acceptCurrentSkill(
  review: InstallReviewResult,
  source: ReviewSource,
  skill: ReviewSkill,
): InstallReviewSelection {
  requireSource(review, source)
  requireSkill(source, skill)
  if (source.current === null || skill.current === null) {
    reject('skill cannot be accepted', source, skill)
  }
  if (skill.accepted?.contentHash === skill.current.contentHash) {
    reject('skill is unchanged', source, skill)
  }
  if (!isInstallReviewSkillEligible(skill)) {
    reject('skill is not eligible', source, skill)
  }
  return Object.freeze({ action: 'accept', source, skill })
}

export function revokeLockedSkill(
  review: InstallReviewResult,
  source: ReviewSource,
  skill: ReviewSkill,
): InstallReviewSelection {
  requireSource(review, source)
  requireSkill(source, skill)
  if (source.accepted === null || skill.accepted === null) {
    reject('skill cannot be revoked', source, skill)
  }
  return Object.freeze({ action: 'revoke', source, skill })
}

export function revokeEmptySource(
  review: InstallReviewResult,
  source: ReviewSource,
): InstallReviewSelection {
  requireSource(review, source)
  if (source.accepted === null) {
    reject('source cannot be revoked', source)
  }
  if (source.skills.length !== 0) {
    reject('source is not empty', source)
  }
  return Object.freeze({ action: 'revoke', source, skill: null })
}

export function buildAcceptedLockfileProposal(
  review: InstallReviewResult,
  selections: ReadonlyArray<InstallReviewSelection>,
): IntentLockfile {
  const proposal = canonicalIntentLockfile(
    review.lock.status === 'found'
      ? review.lock.value
      : { lockfileVersion: 1, sources: [] },
  )
  const selectedTargets = new Set<string>()

  for (const selection of selections) {
    const source = selection.source
    requireSource(review, source)
    const identity = getInstallReviewSourceIdentity(source)
    const sourceName = `${identity.kind}:${identity.id}`
    const skill = selection.skill
    if (skill !== null) requireSkill(source, skill)
    const path = skill === null ? '' : getInstallReviewSkillPath(skill)
    const targetKey = `${sourceIdentityKey(identity)}\u0000${path}`
    if (selectedTargets.has(targetKey)) {
      throw new Error(`Duplicate install review selection: ${sourceName}`)
    }
    selectedTargets.add(targetKey)

    const proposalSourceIndex = proposal.sources.findIndex(
      (candidate) =>
        sourceIdentityKey(candidate) === sourceIdentityKey(identity),
    )
    let proposalSource = proposal.sources[proposalSourceIndex]

    if (selection.action === 'revoke') {
      if (skill === null) {
        if (source.accepted === null || source.skills.length !== 0) {
          reject('source cannot be revoked', source)
        }
        if (
          proposalSource === undefined ||
          proposalSource.skills.length !== 0
        ) {
          throw new Error(`Empty prior lock source not found: ${sourceName}`)
        }
        proposal.sources.splice(proposalSourceIndex, 1)
        continue
      }
      if (source.accepted === null || skill.accepted === null) {
        reject('skill cannot be revoked', source, skill)
      }
      const proposalSkillIndex = proposalSource?.skills.findIndex(
        (candidate) => candidate.path === path,
      )
      if (
        proposalSource === undefined ||
        proposalSkillIndex === undefined ||
        proposalSkillIndex < 0
      ) {
        throw new Error(`Prior lock skill not found: ${sourceName}:${path}`)
      }
      proposalSource.skills.splice(proposalSkillIndex, 1)
      if (proposalSource.skills.length === 0)
        proposal.sources.splice(proposalSourceIndex, 1)
      continue
    }

    if (skill === null) {
      reject('skill cannot be accepted', source)
    }
    if (
      source.current === null ||
      skill.current === null ||
      skill.accepted?.contentHash === skill.current.contentHash
    ) {
      reject('skill cannot be accepted', source, skill)
    }
    if (!isInstallReviewSkillEligible(skill)) {
      reject('skill is not eligible', source, skill)
    }

    if (proposalSource === undefined && skill.accepted === null) {
      proposalSource = {
        ...identity,
        observedVersion: source.current.observedVersion,
        skills: [],
      }
      proposal.sources.push(proposalSource)
    }
    if (proposalSource === undefined) {
      throw new Error(`Prior lock source not found: ${sourceName}`)
    }
    proposalSource.observedVersion = source.current.observedVersion

    if (skill.accepted === null) {
      proposalSource.skills.push({
        path,
        contentHash: skill.current.contentHash,
      })
    } else {
      const proposalSkill = proposalSource.skills.find(
        (candidate) => candidate.path === path,
      )
      if (proposalSkill === undefined) {
        throw new Error(`Prior lock skill not found: ${sourceName}:${path}`)
      }
      proposalSkill.contentHash = skill.current.contentHash
    }
  }

  return canonicalIntentLockfile(proposal)
}
