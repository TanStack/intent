import { createInterface } from 'node:readline/promises'
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
import type { LockfileFieldChange } from '../../core/lockfile/lockfile-diff.js'
import type { IntentLockfileSource } from '../../core/lockfile/lockfile.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsApproveCommandOptions {
  all?: boolean
  frozen?: boolean
  noFrozen?: boolean
}

type PendingChange =
  | { kind: 'add'; identity: string; source: IntentLockfileSource }
  | { kind: 'remove'; identity: string; source: IntentLockfileSource }
  | {
      kind: 'update'
      identity: string
      source: IntentLockfileSource
      fields: Array<LockfileFieldChange>
    }

export type ConfirmFn = (question: string) => Promise<boolean>

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function formatDisclosures(source: IntentLockfileSource): string {
  const parts: Array<string> = []
  if (source.capabilities.length > 0) {
    parts.push(`capabilities: ${source.capabilities.join(', ')}`)
  }
  if (source.declaredSecrets.length > 0) {
    parts.push(`declaredSecrets: ${source.declaredSecrets.join(', ')}`)
  }
  if (source.mcpTools.length > 0) {
    parts.push(`mcpTools: ${source.mcpTools.join(', ')}`)
  }
  return parts.length > 0 ? ` [${parts.join('; ')}]` : ''
}

function describeChange(change: PendingChange): string {
  const label = `${change.source.kind}:${change.source.id}@${change.source.version}`
  switch (change.kind) {
    case 'add':
      return `Approve new source ${label}?${formatDisclosures(change.source)}`
    case 'remove':
      return `Approve removal of ${label} (no longer discovered)?`
    case 'update': {
      const fieldSummary = change.fields
        .map(
          (field) =>
            `${field.field}: ${JSON.stringify(field.from)} -> ${JSON.stringify(field.to)}`,
        )
        .join('; ')
      return `Approve change to ${label}? (${fieldSummary})`
    }
  }
}

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} (y/N) `)
    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

export async function runSkillsApproveCommand(
  sourceArg: string | undefined,
  options: SkillsApproveCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
  confirm: ConfirmFn = defaultConfirm,
): Promise<void> {
  const frozen = isFrozenMode({
    frozen: options.frozen,
    noFrozen: options.noFrozen,
  })
  if (frozen) {
    fail('`intent skills approve` cannot run in frozen mode.')
  }

  if (sourceArg && options.all) {
    fail('Pass either a source id or --all, not both.')
  }

  const { scan, hiddenSourceCount } = await scanPolicedIntents()
  if (hiddenSourceCount > 0) {
    console.log(
      `${hiddenSourceCount} discovered skill-bearing source(s) are not listed in intent.skills and were not considered.`,
    )
  }

  const { current, lockedResult, diff } = computeLockfileState(scan, cwd)

  const finalSources = new Map(
    lockedResult.status === 'found'
      ? lockedResult.lockfile.sources.map((source) => [
          sourceIdentityKey(source),
          source,
        ])
      : [],
  )

  const currentByIdentity = new Map(
    current.map((source) => [sourceIdentityKey(source), source]),
  )

  // diffLockfileSources leaves added/removed/changed empty when there's no
  // lockfile (a distinct state, not diff-against-empty) — first run must
  // build pending changes from `current` directly, not `diff`.
  const changes: Array<PendingChange> =
    lockedResult.status === 'missing'
      ? current
          .map((source) => ({
            kind: 'add' as const,
            identity: sourceIdentityKey(source),
            source,
          }))
          .toSorted((a, b) => compareStrings(a.identity, b.identity))
      : [
          ...diff.added.map((source) => ({
            kind: 'add' as const,
            identity: sourceIdentityKey(source),
            source,
          })),
          ...diff.changed.map((change) => {
            const identity = sourceIdentityKey({
              kind: change.kind,
              id: change.id,
            })
            const source = currentByIdentity.get(identity)
            if (!source) {
              throw new Error(
                `Internal error: no current source found for changed identity ${identity}.`,
              )
            }
            return {
              kind: 'update' as const,
              identity,
              source,
              fields: change.fields,
            }
          }),
          ...diff.removed.map((source) => ({
            kind: 'remove' as const,
            identity: sourceIdentityKey(source),
            source,
          })),
        ]

  let toApply: Array<PendingChange>

  if (sourceArg) {
    const identity = sourceIdentityKey(parseSourceArg(sourceArg))
    const match = changes.find((change) => change.identity === identity)
    if (!match) {
      fail(
        `No pending change for "${sourceArg}". Run \`intent skills diff\` to see pending changes.`,
      )
    }
    toApply = [match]
  } else if (changes.length === 0) {
    console.log('intent.lock is up to date. Nothing to approve.')
    return
  } else if (options.all) {
    toApply = changes
  } else {
    if (confirm === defaultConfirm && process.stdin.isTTY !== true) {
      fail(
        '`intent skills approve` needs --all or a source id when stdin is not a TTY.',
      )
    }
    toApply = []
    for (const change of changes) {
      if (await confirm(describeChange(change))) {
        toApply.push(change)
      }
    }
  }

  if (toApply.length === 0) {
    console.log('No changes approved. intent.lock left unchanged.')
    return
  }

  for (const change of toApply) {
    if (change.kind === 'remove') {
      finalSources.delete(change.identity)
    } else {
      finalSources.set(change.identity, change.source)
    }
  }

  writeIntentLockfile(resolveLockfilePath(cwd), {
    lockfileVersion: 1,
    intentVersion: getIntentPackageVersion(),
    sources: [...finalSources.values()],
    policy:
      lockedResult.status === 'found'
        ? lockedResult.lockfile.policy
        : { ignores: [] },
  })

  console.log(`Wrote ${toApply.length} change(s) to intent.lock.`)
}
