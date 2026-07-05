import { isFrozenMode } from '../../shared/mode.js'
import { buildSkillsDiff, enforceFrozenMode } from './support.js'
import type {
  LockfileDiffResult,
  LockfileSourceChange,
} from '../../core/lockfile/lockfile-diff.js'
import type { IntentLockfileSource } from '../../core/lockfile/lockfile.js'
import type { ScanResult } from '../../shared/types.js'

export interface SkillsDiffCommandOptions {
  json?: boolean
  frozen?: boolean
  noFrozen?: boolean
}

function formatSourceLabel(source: IntentLockfileSource): string {
  return `${source.kind}:${source.id}@${source.version}`
}

function formatChangeLabel(change: LockfileSourceChange): string {
  return `${change.kind}:${change.id}`
}

function printDiffDetails(diff: LockfileDiffResult): void {
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
    }
    console.log()
  }

  if (diff.changed.length > 0) {
    console.log('Changed:')
    for (const change of diff.changed) {
      console.log(`  ~ ${formatChangeLabel(change)}`)
      for (const field of change.fields) {
        console.log(
          `      ${field.field}: ${JSON.stringify(field.from)} -> ${JSON.stringify(field.to)}`,
        )
      }
    }
  }
}

export async function runSkillsDiffCommand(
  options: SkillsDiffCommandOptions,
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
    printDiffDetails(diff)
  }

  enforceFrozenMode(diff, frozen)
}
