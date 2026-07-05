import { sourceIdentityKey } from '../types.js'
import { canonicalSource } from './lockfile.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from './lockfile.js'
import type { SourceIdentity } from '../types.js'

export type LockfileChangeField =
  | 'version'
  | 'resolution'
  | 'contentHash'
  | 'manifestHash'
  | 'capabilities'
  | 'declaredSecrets'
  | 'mcpTools'
  | 'mcpPolicy'

export interface LockfileFieldChange {
  field: LockfileChangeField
  from: unknown
  to: unknown
}

export interface LockfileSourceChange {
  id: string
  kind: SourceIdentity['kind']
  fields: Array<LockfileFieldChange>
}

export interface LockfileDiffResult {
  hasLockfile: boolean
  added: Array<IntentLockfileSource>
  removed: Array<IntentLockfileSource>
  changed: Array<LockfileSourceChange>
  isClean: boolean
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortBySourceIdentity<T extends SourceIdentity>(
  items: Array<T>,
): Array<T> {
  return items.toSorted((a, b) =>
    compareStrings(sourceIdentityKey(a), sourceIdentityKey(b)),
  )
}

function diffFields(
  locked: IntentLockfileSource,
  current: IntentLockfileSource,
): Array<LockfileFieldChange> {
  const lockedCanonical = canonicalSource(locked)
  const currentCanonical = canonicalSource(current)
  const changes: Array<LockfileFieldChange> = []

  const comparePrimitiveField = (
    field: 'version' | 'resolution' | 'contentHash' | 'manifestHash',
  ): void => {
    const from = lockedCanonical[field]
    const to = currentCanonical[field]
    if (from !== to) {
      changes.push({ field, from, to })
    }
  }

  const compareStructuredField = (
    field: 'capabilities' | 'declaredSecrets' | 'mcpTools' | 'mcpPolicy',
  ): void => {
    const from = lockedCanonical[field]
    const to = currentCanonical[field]
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field, from, to })
    }
  }

  comparePrimitiveField('version')
  comparePrimitiveField('resolution')
  comparePrimitiveField('contentHash')
  comparePrimitiveField('manifestHash')
  compareStructuredField('capabilities')
  compareStructuredField('declaredSecrets')
  compareStructuredField('mcpTools')
  compareStructuredField('mcpPolicy')

  return changes
}

export function diffLockfileSources(
  current: ReadonlyArray<IntentLockfileSource>,
  lockedResult: ReadIntentLockfileResult,
): LockfileDiffResult {
  if (lockedResult.status === 'missing') {
    return {
      hasLockfile: false,
      added: [],
      removed: [],
      changed: [],
      isClean: false,
    }
  }

  const lockedSources = lockedResult.lockfile.sources
  const currentByKey = new Map(
    current.map((source) => [sourceIdentityKey(source), source]),
  )
  const lockedByKey = new Map(
    lockedSources.map((source) => [sourceIdentityKey(source), source]),
  )

  const added = sortBySourceIdentity(
    current
      .filter((source) => !lockedByKey.has(sourceIdentityKey(source)))
      .map(canonicalSource),
  )
  const removed = sortBySourceIdentity(
    lockedSources.filter(
      (source) => !currentByKey.has(sourceIdentityKey(source)),
    ),
  )

  const changed: Array<LockfileSourceChange> = []
  for (const [key, lockedSource] of lockedByKey) {
    const currentSource = currentByKey.get(key)
    if (!currentSource) continue

    const fields = diffFields(lockedSource, currentSource)
    if (fields.length > 0) {
      changed.push({ id: currentSource.id, kind: currentSource.kind, fields })
    }
  }

  return {
    hasLockfile: true,
    added,
    removed,
    changed: sortBySourceIdentity(changed),
    isClean: added.length === 0 && removed.length === 0 && changed.length === 0,
  }
}
