import {
  assertSourceContentReviewsMatch,
  buildSourceContentReviews,
} from '../../core/lockfile/content-review.js'
import { sourceIdentityKey } from '../../core/types.js'
import { isFrozenMode } from '../../shared/mode.js'
import { escapeReviewValue, formatReviewJson } from '../../shared/cli-output.js'
import {
  computeLockfileState,
  enforceFrozenMode,
  formatHiddenSourceDetails,
  printSourceContentReviews,
} from './support.js'
import type {
  LockfileDiffResult,
  LockfileSourceChange,
} from '../../core/lockfile/lockfile-diff.js'
import type { IntentLockfileSource } from '../../core/lockfile/lockfile.js'
import type { IntentHiddenSourceSummary } from '../../core/types.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsDiffCommandOptions {
  json?: boolean
  frozen?: boolean
  noFrozen?: boolean
}

function formatSourceLabel(source: IntentLockfileSource): string {
  return `${source.kind}:${escapeReviewValue(source.id)}@${escapeReviewValue(source.version)}`
}

function formatChangeLabel(change: LockfileSourceChange): string {
  return `${change.kind}:${escapeReviewValue(change.id)}`
}

function printDiffDetails(
  diff: LockfileDiffResult,
  hiddenSourceCount: number,
  hiddenSources: ReadonlyArray<IntentHiddenSourceSummary>,
): void {
  if (hiddenSourceCount > 0) {
    console.log(
      `${hiddenSourceCount} discovered skill-bearing source(s) are not listed in intent.skills${formatHiddenSourceDetails(hiddenSources)}. Add them to intent.skills or intent.exclude.`,
    )
  }

  if (!diff.hasLockfile) {
    console.log(
      'No intent.lock found. Run `intent skills approve --all` to create one.',
    )
    return
  }

  if (diff.isClean) {
    console.log('intent.lock is up to date.')
    return
  }

  if (diff.added.length > 0) {
    console.log('Added:')
    for (const source of diff.added) {
      console.log(`  + ${formatSourceLabel(source)}`)
    }
    console.log()
  }

  if (diff.removed.length > 0) {
    console.log('Removed:')
    for (const source of diff.removed) {
      console.log(`  - ${formatSourceLabel(source)}`)
      console.log(
        `      skills: ${source.skills.length > 0 ? source.skills.map(escapeReviewValue).join(', ') : '(none)'}`,
      )
      console.log(`      contentHash: ${source.contentHash}`)
    }
    console.log()
  }

  if (diff.changed.length > 0) {
    console.log('Changed:')
    for (const change of diff.changed) {
      console.log(`  ~ ${formatChangeLabel(change)}`)
      for (const field of change.fields) {
        console.log(
          `      ${field.field}: ${formatReviewJson(field.from)} -> ${formatReviewJson(field.to)}`,
        )
      }
    }
  }
}

export async function runSkillsDiffCommand(
  options: SkillsDiffCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
): Promise<void> {
  const frozen = isFrozenMode({
    frozen: options.frozen,
    noFrozen: options.noFrozen,
  })
  const { scan, hiddenSourceCount, hiddenSources } = await scanPolicedIntents()
  const { current, diff } = computeLockfileState(scan, cwd)

  if (options.json) {
    console.log(JSON.stringify({ frozen, hiddenSourceCount, ...diff }, null, 2))
  } else {
    printDiffDetails(diff, hiddenSourceCount, hiddenSources)
    const reviewIdentities = new Set(
      diff.hasLockfile
        ? [
            ...diff.added.map(sourceIdentityKey),
            ...diff.changed.map(sourceIdentityKey),
          ]
        : scan.packages.map((pkg) =>
            sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
          ),
    )
    const reviews = buildSourceContentReviews(
      scan.packages,
      reviewIdentities,
      scan.readFs,
    )
    assertSourceContentReviewsMatch(reviews, current)
    printSourceContentReviews(reviews)
  }

  enforceFrozenMode(diff, frozen, hiddenSourceCount, hiddenSources)
}
