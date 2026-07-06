import { isFrozenMode } from '../../shared/mode.js'
import { buildSkillsDiff, enforceFrozenMode } from './support.js'
import type { LockfileDiffResult } from '../../core/lockfile/lockfile-diff.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsScanCommandOptions {
  json?: boolean
  frozen?: boolean
  noFrozen?: boolean
}

function printScanSummary(
  diff: LockfileDiffResult,
  hiddenSourceCount: number,
): void {
  if (hiddenSourceCount > 0) {
    console.log(
      `${hiddenSourceCount} discovered skill-bearing source(s) are not listed in intent.skills. Add them to intent.skills or intent.exclude.`,
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

  console.log(
    `intent.lock is out of date: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed.`,
  )
  console.log(
    'Run `intent skills diff` for details, or `intent skills approve` to update.',
  )
}

export async function runSkillsScanCommand(
  options: SkillsScanCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
): Promise<void> {
  const frozen = isFrozenMode({
    frozen: options.frozen,
    noFrozen: options.noFrozen,
  })
  const { scan, hiddenSourceCount } = await scanPolicedIntents()
  const diff = buildSkillsDiff(scan, cwd)

  if (options.json) {
    console.log(JSON.stringify({ frozen, hiddenSourceCount, ...diff }, null, 2))
  } else {
    printScanSummary(diff, hiddenSourceCount)
  }

  enforceFrozenMode(diff, frozen, hiddenSourceCount)
}
