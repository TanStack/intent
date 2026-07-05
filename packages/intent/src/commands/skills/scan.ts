import { isFrozenMode } from '../../shared/mode.js'
import { buildSkillsDiff, enforceFrozenMode } from './support.js'
import type { LockfileDiffResult } from '../../core/lockfile/lockfile-diff.js'
import type { ScanResult } from '../../shared/types.js'

export interface SkillsScanCommandOptions {
  json?: boolean
  frozen?: boolean
  noFrozen?: boolean
}

function printScanSummary(diff: LockfileDiffResult): void {
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
  scanIntents: () => Promise<ScanResult>,
  cwd: string = process.cwd(),
): Promise<void> {
  const frozen = isFrozenMode({
    frozen: options.frozen,
    noFrozen: options.noFrozen,
  })
  const scan = await scanIntents()
  const diff = buildSkillsDiff(scan, cwd)

  if (options.json) {
    console.log(JSON.stringify({ frozen, ...diff }, null, 2))
  } else {
    printScanSummary(diff)
  }

  enforceFrozenMode(diff, frozen)
}
