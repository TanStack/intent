import { getIntentPackageVersion } from '../support.js'
import { writeIntentLockfile } from '../../core/lockfile/lockfile.js'
import { sourceIdentityKey } from '../../core/types.js'
import { isFrozenMode } from '../../shared/mode.js'
import { fail } from '../../shared/cli-error.js'
import {
  computeLockfileState,
  resolveLockfilePath,
  resolveSourceArg,
} from './support.js'
import type {
  LockfileDiffResult,
  LockfileSourceChange,
} from '../../core/lockfile/lockfile-diff.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsUpdateCommandOptions {
  all?: boolean
  yes?: boolean
  frozen?: boolean
  noFrozen?: boolean
}

function requiresApproval(change: LockfileSourceChange): boolean {
  return change.fields.some(
    ({ field }) =>
      field === 'skills' ||
      field === 'contentHash' ||
      field === 'manifestHash' ||
      field === 'capabilities' ||
      field === 'declaredSecrets' ||
      field === 'mcpTools' ||
      field === 'mcpPolicy',
  )
}

function formatChangeLabel(change: LockfileSourceChange): string {
  return `${change.kind}:${change.id}`
}

function printUpdated(changes: ReadonlyArray<LockfileSourceChange>): void {
  console.log(`Updated ${changes.length} source(s) in intent.lock:`)
  for (const change of changes) {
    console.log(`  ~ ${formatChangeLabel(change)}`)
    for (const field of change.fields) {
      console.log(
        `      ${field.field}: ${JSON.stringify(field.from)} -> ${JSON.stringify(field.to)}`,
      )
    }
  }
}

// update only ever touches the changed set (§7.4); added/removed sources are
// approve's trust decision, so surface them here or the operator sees a
// clean "Updated N" with no sign that other drift still needs approve.
function printPendingAddRemove(diff: LockfileDiffResult): void {
  if (diff.added.length === 0 && diff.removed.length === 0) return
  console.log(
    `${diff.added.length} added, ${diff.removed.length} removed source(s) still pending. Run \`intent skills approve\` to review.`,
  )
}

export async function runSkillsUpdateCommand(
  sourceArg: string | undefined,
  options: SkillsUpdateCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
): Promise<void> {
  const frozen = isFrozenMode({
    frozen: options.frozen,
    noFrozen: options.noFrozen,
  })
  if (frozen) {
    fail('`intent skills update` cannot run in frozen mode.', 5)
  }

  if (sourceArg && options.all) {
    fail('Pass either a source id or --all, not both.')
  }

  const { scan } = await scanPolicedIntents()
  const { current, lockedResult, diff } = computeLockfileState(scan, cwd)

  if (lockedResult.status === 'missing') {
    fail(
      'No intent.lock found. Run `intent skills approve --all` to create one.',
    )
  }

  let targets: Array<LockfileSourceChange>

  if (sourceArg) {
    const identity = sourceIdentityKey(resolveSourceArg(sourceArg, current))
    const lockedByIdentity = new Set(
      lockedResult.lockfile.sources.map((source) => sourceIdentityKey(source)),
    )
    const currentByIdentity = new Set(
      current.map((source) => sourceIdentityKey(source)),
    )

    if (!lockedByIdentity.has(identity)) {
      fail(
        `"${sourceArg}" is not in intent.lock. Run \`intent skills approve\` first.`,
      )
    }
    if (!currentByIdentity.has(identity)) {
      fail(
        `"${sourceArg}" is locked but no longer discovered; nothing to update.`,
      )
    }

    const match = diff.changed.find(
      (change) =>
        sourceIdentityKey({ kind: change.kind, id: change.id }) === identity,
    )
    if (!match) {
      console.log(
        `intent.lock already matches the installed state for "${sourceArg}". Nothing to update.`,
      )
      printPendingAddRemove(diff)
      return
    }
    targets = [match]
  } else {
    targets = diff.changed
  }

  if (targets.length === 0) {
    console.log(
      'intent.lock already matches installed sources. Nothing to update.',
    )
    printPendingAddRemove(diff)
    return
  }

  if (targets.some(requiresApproval) && !options.yes) {
    fail(
      'Trust-bearing source changes require `--yes`. Run `intent skills diff` to review, then re-run with `--yes` to update intent.lock.',
    )
  }

  const currentByIdentity = new Map(
    current.map((source) => [sourceIdentityKey(source), source]),
  )
  const finalSources = new Map(
    lockedResult.lockfile.sources.map((source) => [
      sourceIdentityKey(source),
      source,
    ]),
  )

  for (const change of targets) {
    const identity = sourceIdentityKey({ kind: change.kind, id: change.id })
    const source = currentByIdentity.get(identity)
    if (!source) {
      throw new Error(
        `Internal error: no current source found for changed identity ${identity}.`,
      )
    }
    finalSources.set(identity, source)
  }

  writeIntentLockfile(resolveLockfilePath(cwd), {
    lockfileVersion: 1,
    intentVersion: getIntentPackageVersion(),
    ...(lockedResult.lockfile.staleness
      ? { staleness: lockedResult.lockfile.staleness }
      : {}),
    sources: [...finalSources.values()],
    policy: lockedResult.lockfile.policy,
  })

  printUpdated(targets)
  printPendingAddRemove(diff)
}
