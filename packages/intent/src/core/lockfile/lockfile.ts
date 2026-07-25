import { readFileSync } from 'node:fs'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import { validateSkillPaths } from '../skill-path.js'

export interface IntentLockfileSkill {
  path: string
  contentHash: string
}

export interface IntentLockfileSource {
  kind: 'npm' | 'workspace'
  id: string
  skills: Array<IntentLockfileSkill>
}

export interface IntentLockfile {
  lockfileVersion: 1
  sources: Array<IntentLockfileSource>
}

export type ReadIntentLockfileResult =
  | { status: 'missing' }
  | { status: 'found'; lockfile: IntentLockfile }

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sourceKey(source: Pick<IntentLockfileSource, 'kind' | 'id'>): string {
  return `${source.kind}\0${source.id}`
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid intent.lock ${label}: expected an object.`)
  }
  return value as Record<string, unknown>
}

function assertFields(
  value: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`Invalid intent.lock ${label}: unknown field "${key}".`)
    }
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `Invalid intent.lock ${label}: expected a non-empty string.`,
    )
  }
  return value
}

function canonicalSource(source: IntentLockfileSource): IntentLockfileSource {
  const paths = source.skills.map((skill) => skill.path)
  validateSkillPaths(paths)
  return {
    kind: source.kind,
    id: source.id,
    skills: source.skills
      .map((skill) => ({
        path: skill.path,
        contentHash: skill.contentHash,
      }))
      .sort((a, b) => compareStrings(a.path, b.path)),
  }
}

export function canonicalIntentLockfile(
  lockfile: IntentLockfile,
): IntentLockfile {
  const sources = lockfile.sources.map(canonicalSource)
  const seen = new Set<string>()
  for (const source of sources) {
    const key = sourceKey(source)
    if (seen.has(key)) {
      throw new Error(
        `Duplicate intent.lock source: ${source.kind}:${source.id}.`,
      )
    }
    seen.add(key)
  }
  return {
    lockfileVersion: 1,
    sources: sources.sort((a, b) => compareStrings(sourceKey(a), sourceKey(b))),
  }
}

export function parseIntentLockfile(content: string): IntentLockfile {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error(
      `Invalid intent.lock JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const root = assertRecord(parsed, 'root')
  assertFields(root, ['lockfileVersion', 'sources'], 'root')
  if (typeof root.lockfileVersion === 'number' && root.lockfileVersion > 1) {
    throw new Error(
      `intent.lock declares lockfileVersion ${root.lockfileVersion}, which this @tanstack/intent cannot read. Upgrade @tanstack/intent.`,
    )
  }
  if (root.lockfileVersion !== 1 || !Array.isArray(root.sources)) {
    throw new Error('Invalid intent.lock root.')
  }
  return canonicalIntentLockfile({
    lockfileVersion: 1,
    sources: root.sources.map((value, sourceIndex) => {
      const source = assertRecord(value, `sources[${sourceIndex}]`)
      assertFields(source, ['kind', 'id', 'skills'], `sources[${sourceIndex}]`)
      if (!Array.isArray(source.skills)) {
        throw new Error(`Invalid intent.lock sources[${sourceIndex}].skills.`)
      }
      if (source.kind !== 'npm' && source.kind !== 'workspace') {
        throw new Error(
          `intent.lock contains a "${String(source.kind)}" source, which this @tanstack/intent cannot read. Upgrade @tanstack/intent if a newer version wrote this lockfile.`,
        )
      }
      return {
        kind: source.kind,
        id: assertString(source.id, `sources[${sourceIndex}].id`),
        skills: source.skills.map((skill, skillIndex) => {
          const record = assertRecord(
            skill,
            `sources[${sourceIndex}].skills[${skillIndex}]`,
          )
          assertFields(
            record,
            ['path', 'contentHash'],
            `sources[${sourceIndex}].skills[${skillIndex}]`,
          )
          return {
            path: assertString(
              record.path,
              `sources[${sourceIndex}].skills[${skillIndex}].path`,
            ),
            contentHash: assertString(
              record.contentHash,
              `sources[${sourceIndex}].skills[${skillIndex}].contentHash`,
            ),
          }
        }),
      }
    }),
  })
}

export function serializeIntentLockfile(lockfile: IntentLockfile): string {
  return `${JSON.stringify(canonicalIntentLockfile(lockfile), null, 2)}\n`
}

export function readIntentLockfile(filePath: string): ReadIntentLockfileResult {
  try {
    return {
      status: 'found',
      lockfile: parseIntentLockfile(readFileSync(filePath, 'utf8')),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { status: 'missing' }
    throw error
  }
}

export function writeIntentLockfile(
  filePath: string,
  lockfile: IntentLockfile,
): void {
  writeTextFileAtomic(filePath, serializeIntentLockfile(lockfile))
}
