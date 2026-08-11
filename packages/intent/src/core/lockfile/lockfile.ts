import { Buffer } from 'node:buffer'
import { lstatSync, readFileSync } from 'node:fs'
import { TextDecoder } from 'node:util'
import { parseTree } from 'jsonc-parser'
import { validateSkillPaths } from '../skill-path.js'
import { sourceIdentityKey } from '../types.js'
import type { Node } from 'jsonc-parser'
import type { SourceIdentity } from '../types.js'

const CONTROL_OR_BIDI_PATTERN =
  /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
const CONTENT_HASH_PATTERN = /^sha256-[0-9a-f]{64}$/
const MAX_LOCKFILE_BYTES = 1024 * 1024

interface IntentLockfileSkill {
  path: string
  contentHash: string
}

export interface IntentLockfileSource extends SourceIdentity {
  observedVersion: string
  skills: Array<IntentLockfileSkill>
}

export interface IntentLockfile {
  lockfileVersion: 1
  sources: Array<IntentLockfileSource>
}

export type ReadIntentLockfileResult =
  { status: 'missing' } | { status: 'found'; lockfile: IntentLockfile }

function requireRecord(
  value: unknown,
  location: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, location: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${location} must be a string`)
  }
  return value
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: ReadonlyArray<string>,
  location: string,
): void {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${location} missing field: ${field}`)
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      throw new Error(`${location} unknown field: ${field}`)
    }
  }
}

function validateBoundedText(
  value: unknown,
  location: string,
  maxBytes: number,
  allowEmpty: boolean,
): string {
  const text = requireString(value, location)
  if (!allowEmpty && text === '') {
    throw new Error(`${location} must not be empty`)
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`${location} must be at most ${maxBytes} UTF-8 bytes`)
  }
  if (CONTROL_OR_BIDI_PATTERN.test(text)) {
    throw new Error(`${location} must not contain control characters`)
  }
  return text
}

function validateLockfile(value: unknown): IntentLockfile {
  const root = requireRecord(value, 'intent.lock')
  requireExactFields(root, ['lockfileVersion', 'sources'], 'intent.lock')
  if (
    typeof root.lockfileVersion === 'number' &&
    Number.isInteger(root.lockfileVersion) &&
    root.lockfileVersion > 1
  ) {
    throw new Error(
      `intent.lock version ${root.lockfileVersion} requires a newer version of @tanstack/intent`,
    )
  }
  if (root.lockfileVersion !== 1) {
    throw new Error('intent.lock lockfileVersion must be 1')
  }
  if (!Array.isArray(root.sources)) {
    throw new Error('intent.lock sources must be an array')
  }

  const seenSources = new Set<string>()
  const sources = root.sources.map((
    value,
    sourceIndex,
  ): IntentLockfileSource => {
    const source = requireRecord(value, `sources[${sourceIndex}]`)
    requireExactFields(
      source,
      ['kind', 'id', 'observedVersion', 'skills'],
      `sources[${sourceIndex}]`,
    )
    if (source.kind !== 'npm' && source.kind !== 'workspace') {
      throw new Error(`sources[${sourceIndex}].kind must be npm or workspace`)
    }
    const kind: SourceIdentity['kind'] = source.kind
    if (!Array.isArray(source.skills)) {
      throw new Error(`sources[${sourceIndex}].skills must be an array`)
    }

    const skills = source.skills.map((value, skillIndex) => {
      const location = `sources[${sourceIndex}].skills[${skillIndex}]`
      const skill = requireRecord(value, location)
      requireExactFields(skill, ['path', 'contentHash'], location)
      const contentHash = requireString(
        skill.contentHash,
        `${location}.contentHash`,
      )
      if (!CONTENT_HASH_PATTERN.test(contentHash)) {
        throw new Error(
          `${location}.contentHash must be sha256- followed by 64 lowercase hex characters`,
        )
      }
      return {
        path: requireString(skill.path, `${location}.path`),
        contentHash,
      }
    })
    const validatedPaths = validateSkillPaths(skills.map((skill) => skill.path))
    const id = validateBoundedText(
      source.id,
      `sources[${sourceIndex}].id`,
      214,
      false,
    )
    const observedVersion = validateBoundedText(
      source.observedVersion,
      `sources[${sourceIndex}].observedVersion`,
      256,
      kind === 'workspace',
    )
    const identityKey = sourceIdentityKey({ kind, id })
    if (seenSources.has(identityKey)) {
      throw new Error(`Duplicate source: ${kind}:${id}`)
    }
    seenSources.add(identityKey)

    return {
      kind,
      id,
      observedVersion,
      skills: skills.map((skill, skillIndex) => ({
        path: validatedPaths[skillIndex]!,
        contentHash: skill.contentHash,
      })),
    }
  })

  return { lockfileVersion: 1, sources }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function rejectDuplicateObjectKeys(root: Node): void {
  const nodes = [root]

  while (nodes.length > 0) {
    const node = nodes.pop()!
    if (node.type === 'object') {
      const keys = new Set<string>()
      for (const property of node.children ?? []) {
        const keyNode = property.children?.[0]
        if (
          property.type !== 'property' ||
          keyNode?.type !== 'string' ||
          typeof keyNode.value !== 'string'
        ) {
          throw new Error('Unable to inspect intent.lock object keys')
        }
        if (keys.has(keyNode.value)) {
          throw new Error(`Duplicate object key: ${keyNode.value}`)
        }
        keys.add(keyNode.value)
      }
    }
    nodes.push(...(node.children ?? []))
  }
}

export function canonicalIntentLockfile(
  lockfile: IntentLockfile,
): IntentLockfile {
  const validated = validateLockfile(lockfile)
  return {
    lockfileVersion: 1,
    sources: validated.sources
      .map<IntentLockfileSource>((source) => ({
        kind: source.kind,
        id: source.id,
        observedVersion: source.observedVersion,
        skills: source.skills
          .map((skill) => ({
            path: skill.path,
            contentHash: skill.contentHash,
          }))
          .sort((left, right) => compareCodeUnits(left.path, right.path)),
      }))
      .sort((left, right) =>
        compareCodeUnits(sourceIdentityKey(left), sourceIdentityKey(right)),
      ),
  }
}

export function parseIntentLockfile(content: string): IntentLockfile {
  const parsed: unknown = JSON.parse(content)
  const tree = parseTree(content)
  if (tree === undefined) {
    throw new Error('Unable to inspect intent.lock JSON')
  }
  rejectDuplicateObjectKeys(tree)
  return validateLockfile(parsed)
}

export function serializeIntentLockfile(lockfile: IntentLockfile): string {
  return `${JSON.stringify(canonicalIntentLockfile(lockfile), null, 2)}\n`
}

export function readIntentLockfile(filePath: string): ReadIntentLockfileResult {
  try {
    const stats = lstatSync(filePath)
    if (stats.isSymbolicLink()) {
      throw new Error('intent.lock must not be a symbolic link')
    }
    if (!stats.isFile()) {
      throw new Error('intent.lock must be a regular file')
    }
    if (stats.size > MAX_LOCKFILE_BYTES) {
      throw new Error('intent.lock exceeds the 1 MiB limit')
    }

    const content = readFileSync(filePath)
    if (content.byteLength > MAX_LOCKFILE_BYTES) {
      throw new Error('intent.lock exceeds the 1 MiB limit')
    }

    return {
      status: 'found',
      lockfile: parseIntentLockfile(
        new TextDecoder('utf-8', { fatal: true }).decode(content),
      ),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' }
    }
    throw error
  }
}
