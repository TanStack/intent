import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sourceIdentityKey } from '../types.js'

const INTENT_LOCKFILE_VERSION = 1

export interface IntentLockfile {
  lockfileVersion: 1
  intentVersion: string
  staleness?: IntentLockfileStaleness
  sources: Array<IntentLockfileSource>
  policy: IntentLockfilePolicy
}

interface IntentLockfileStaleness {
  baseline: IntentLockfileStalenessBaseline
}

interface IntentLockfileStalenessBaseline {
  kind: 'tag'
  ref: string
  commit: string
}

export interface IntentLockfileSource {
  id: string
  kind: 'npm' | 'workspace'
  version: string | null
  resolution: string | null
  skills: Array<string>
  contentHash: string
  manifestHash: string | null
  capabilities: Array<string> | null
  declaredSecrets?: Array<string>
  mcpTools?: Array<string>
  mcpPolicy?: Record<string, unknown>
}

interface IntentLockfilePolicy {
  ignores: Array<IntentLockfilePolicyIgnore>
}

interface IntentLockfilePolicyIgnore {
  id: string
  scope: {
    source: string
    contentHash: string
  }
  reason: string
  createdAt: string
  expiresAt: string
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | Array<JsonValue>
  | { [key: string]: JsonValue }

export type ReadIntentLockfileResult =
  | { status: 'missing' }
  | { status: 'found'; lockfile: IntentLockfile }

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid intent.lock: ${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid intent.lock: ${label} must be a string.`)
  }
  return value
}

function assertNullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return assertString(value, label)
}

function assertStringArray(value: unknown, label: string): Array<string> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(
      `Invalid intent.lock: ${label} must be an array of strings.`,
    )
  }
  return value
}

function assertNullableStringArray(
  value: unknown,
  label: string,
): Array<string> | null {
  if (value === null) return null
  return assertStringArray(value, label)
}

function assertOptionalStringArray(
  value: unknown,
  label: string,
): Array<string> | undefined {
  if (value === undefined) return undefined
  return assertStringArray(value, label)
}

function assertOptionalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return assertRecord(value, label)
}

function assertNoDuplicateSourceIdentities(
  sources: ReadonlyArray<IntentLockfileSource>,
): void {
  const seen = new Set<string>()
  for (const source of sources) {
    const key = sourceIdentityKey(source)
    if (seen.has(key)) {
      throw new Error(
        `Invalid intent.lock: duplicate source identity "${source.kind}:${source.id}".`,
      )
    }
    seen.add(key)
  }
}

function parseSource(value: unknown): IntentLockfileSource {
  const source = assertRecord(value, 'source')
  const kind = source.kind
  if (kind !== 'npm' && kind !== 'workspace') {
    throw new Error(
      'Invalid intent.lock: source.kind must be npm or workspace.',
    )
  }

  return {
    id: assertString(source.id, 'source.id'),
    kind,
    version: assertNullableString(source.version, 'source.version'),
    resolution: assertNullableString(source.resolution, 'source.resolution'),
    skills: assertStringArray(source.skills, 'source.skills'),
    contentHash: assertString(source.contentHash, 'source.contentHash'),
    manifestHash: assertNullableString(
      source.manifestHash,
      'source.manifestHash',
    ),
    capabilities: assertNullableStringArray(
      source.capabilities,
      'source.capabilities',
    ),
    declaredSecrets: assertOptionalStringArray(
      source.declaredSecrets,
      'source.declaredSecrets',
    ),
    mcpTools: assertOptionalStringArray(source.mcpTools, 'source.mcpTools'),
    mcpPolicy: assertOptionalRecord(source.mcpPolicy, 'source.mcpPolicy'),
  }
}

function parsePolicyIgnore(value: unknown): IntentLockfilePolicyIgnore {
  const ignore = assertRecord(value, 'policy.ignore')
  const scope = assertRecord(ignore.scope, 'policy.ignore.scope')
  return {
    id: assertString(ignore.id, 'policy.ignore.id'),
    scope: {
      source: assertString(scope.source, 'policy.ignore.scope.source'),
      contentHash: assertString(
        scope.contentHash,
        'policy.ignore.scope.contentHash',
      ),
    },
    reason: assertString(ignore.reason, 'policy.ignore.reason'),
    createdAt: assertString(ignore.createdAt, 'policy.ignore.createdAt'),
    expiresAt: assertString(ignore.expiresAt, 'policy.ignore.expiresAt'),
  }
}

function parsePolicy(value: unknown): IntentLockfilePolicy {
  const policy = assertRecord(value, 'policy')
  if (!Array.isArray(policy.ignores)) {
    throw new Error('Invalid intent.lock: policy.ignores must be an array.')
  }
  return { ignores: policy.ignores.map(parsePolicyIgnore) }
}

function parseStaleness(value: unknown): IntentLockfileStaleness | undefined {
  if (value === undefined) return undefined
  const staleness = assertRecord(value, 'staleness')
  const baseline = assertRecord(staleness.baseline, 'staleness.baseline')
  if (baseline.kind !== 'tag') {
    throw new Error('Invalid intent.lock: staleness.baseline.kind must be tag.')
  }
  return {
    baseline: {
      kind: 'tag',
      ref: assertString(baseline.ref, 'staleness.baseline.ref'),
      commit: assertString(baseline.commit, 'staleness.baseline.commit'),
    },
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortedStrings(values: Array<string>): Array<string> {
  return values.toSorted(compareStrings)
}

function canonicalJsonValue(value: unknown, label: string): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalJsonValue(item, `${label}[${index}]`),
    )
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([key, item]) => [
          key,
          canonicalJsonValue(item, `${label}.${key}`),
        ]),
    )
  }

  throw new Error(`Invalid intent.lock: ${label} must be JSON-serializable.`)
}

export function canonicalSource(
  source: IntentLockfileSource,
): IntentLockfileSource {
  return {
    id: source.id,
    kind: source.kind,
    version: source.version,
    resolution: source.resolution,
    skills: sortedStrings(source.skills),
    contentHash: source.contentHash,
    manifestHash: source.manifestHash,
    capabilities: source.capabilities
      ? sortedStrings(source.capabilities)
      : null,
    ...(source.declaredSecrets !== undefined
      ? { declaredSecrets: sortedStrings(source.declaredSecrets) }
      : {}),
    ...(source.mcpTools !== undefined
      ? { mcpTools: sortedStrings(source.mcpTools) }
      : {}),
    ...(source.mcpPolicy !== undefined
      ? {
          mcpPolicy: canonicalJsonValue(
            source.mcpPolicy,
            'source.mcpPolicy',
          ) as Record<string, unknown>,
        }
      : {}),
  }
}

function canonicalPolicyIgnore(
  ignore: IntentLockfilePolicyIgnore,
): IntentLockfilePolicyIgnore {
  return {
    id: ignore.id,
    scope: {
      source: ignore.scope.source,
      contentHash: ignore.scope.contentHash,
    },
    reason: ignore.reason,
    createdAt: ignore.createdAt,
    expiresAt: ignore.expiresAt,
  }
}

function canonicalLockfile(lockfile: IntentLockfile): IntentLockfile {
  return {
    lockfileVersion: INTENT_LOCKFILE_VERSION,
    intentVersion: lockfile.intentVersion,
    ...(lockfile.staleness ? { staleness: lockfile.staleness } : {}),
    sources: [...lockfile.sources]
      .sort((a, b) =>
        compareStrings(sourceIdentityKey(a), sourceIdentityKey(b)),
      )
      .map(canonicalSource),
    policy: {
      ignores: [...lockfile.policy.ignores]
        .sort((a, b) => {
          const aKey = `${a.id}\u0000${a.scope.source}\u0000${a.scope.contentHash}`
          const bKey = `${b.id}\u0000${b.scope.source}\u0000${b.scope.contentHash}`
          return compareStrings(aKey, bKey)
        })
        .map(canonicalPolicyIgnore),
    },
  }
}

export function parseIntentLockfile(content: string): IntentLockfile {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(
      `Invalid intent.lock JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const lockfile = assertRecord(parsed, 'root')
  if (lockfile.lockfileVersion !== INTENT_LOCKFILE_VERSION) {
    throw new Error(
      `Unsupported intent.lock version: ${String(lockfile.lockfileVersion)}`,
    )
  }
  if (!Array.isArray(lockfile.sources)) {
    throw new Error('Invalid intent.lock: sources must be an array.')
  }

  const sources = lockfile.sources.map(parseSource)
  assertNoDuplicateSourceIdentities(sources)

  return canonicalLockfile({
    lockfileVersion: INTENT_LOCKFILE_VERSION,
    intentVersion: assertString(lockfile.intentVersion, 'intentVersion'),
    ...(lockfile.staleness !== undefined
      ? { staleness: parseStaleness(lockfile.staleness) }
      : {}),
    sources,
    policy: parsePolicy(lockfile.policy),
  })
}

export function serializeIntentLockfile(lockfile: IntentLockfile): string {
  return `${JSON.stringify(canonicalLockfile(lockfile), null, 2)}\n`
}

export function readIntentLockfile(filePath: string): ReadIntentLockfileResult {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return { status: 'missing' }
    }
    throw err
  }

  return { status: 'found', lockfile: parseIntentLockfile(content) }
}

export function writeIntentLockfile(
  filePath: string,
  lockfile: IntentLockfile,
): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, serializeIntentLockfile(lockfile), 'utf8')
}
