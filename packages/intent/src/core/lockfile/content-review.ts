import { relative, sep } from 'node:path'
import { nodeReadFs } from '../../shared/utils.js'
import { sourceIdentityKey } from '../types.js'
import {
  computeReviewedSourceContentHash,
  readSourceContentForReview,
} from './hash.js'
import type { SourceContentReviewEntry } from './hash.js'
import type { IntentLockfileSource } from './lockfile.js'
import type { IntentPackage } from '../../shared/types.js'
import type { ReadFs } from '../../shared/utils.js'

export interface SourceContentReview {
  id: string
  kind: IntentPackage['kind']
  version: string
  files: Array<SourceContentReviewEntry>
  contentHash: string
}

function toPosixPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

export function buildSourceContentReviews(
  packages: ReadonlyArray<IntentPackage>,
  identities: ReadonlySet<string>,
  fs: ReadFs = nodeReadFs,
): Array<SourceContentReview> {
  const reviews = packages.flatMap((pkg) => {
    if (!identities.has(sourceIdentityKey({ kind: pkg.kind, id: pkg.name }))) {
      return []
    }

    const entries = pkg.skills.map((skill) => ({
      relativePath: toPosixPath(relative(pkg.packageRoot, skill.path)),
      absolutePath: skill.path,
    }))
    const files = readSourceContentForReview(pkg.packageRoot, entries, fs)
    return [
      {
        id: pkg.name,
        kind: pkg.kind,
        version: pkg.version,
        files,
        contentHash: computeReviewedSourceContentHash(files),
      },
    ]
  })

  const found = new Set<string>()
  for (const review of reviews) {
    const identity = sourceIdentityKey(review)
    if (found.has(identity)) {
      throw new Error(
        `Internal error: duplicate content review for ${review.kind}:${review.id}.`,
      )
    }
    found.add(identity)
  }
  for (const identity of identities) {
    if (!found.has(identity)) {
      throw new Error(
        `Internal error: no content review found for ${JSON.stringify(identity)}.`,
      )
    }
  }

  return reviews
}

export function assertSourceContentReviewsMatch(
  reviews: ReadonlyArray<SourceContentReview>,
  current: ReadonlyArray<IntentLockfileSource>,
): void {
  const currentByIdentity = new Map(
    current.map((source) => [sourceIdentityKey(source), source]),
  )
  for (const review of reviews) {
    const source = currentByIdentity.get(sourceIdentityKey(review))
    if (!source || source.contentHash !== review.contentHash) {
      throw new Error(
        `Skill content for ${review.kind}:${review.id} changed while it was being reviewed. Re-run the command before approving.`,
      )
    }
  }
}
