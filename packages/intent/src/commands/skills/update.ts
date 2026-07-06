import { getIntentPackageVersion } from '../support.js'
import { writeIntentLockfile } from '../../core/lockfile/lockfile.js'
import { sourceIdentityKey } from '../../core/types.js'
import { isFrozenMode } from '../../shared/mode.js'
import { fail } from '../../shared/cli-error.js'
import {
  computeLockfileState,
  parseSourceArg,
  resolveLockfilePath,
} from './support.js'
import type { LockfileSourceChange } from '../../core/lockfile/lockfile-diff.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsUpdateCommandOptions {
  all?: boolean
  frozen?: boolean
  noFrozen?: boolean
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
    fail('`intent skills update` cannot run in frozen mode.')
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
    const identity = sourceIdentityKey(parseSourceArg(sourceArg))
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
    return
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
    sources: [...finalSources.values()],
    policy: lockedResult.lockfile.policy,
  })

  printUpdated(targets)
}
