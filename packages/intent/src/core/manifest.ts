// Package-side manifest: `skills/intent.manifest.json`. Ships inside a
// published skill package and gives skill metadata a stable, hashable home
// separate from SKILL.md content. Not a second lockfile — it's a maintainer-
// authored description of what a package's skills are and declare, never a
// consumer approval record, and it never lives in the consumer root.
import { writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { nodeReadFs } from '../shared/utils.js'
import { computeSkillFolderHash } from './lockfile/hash.js'
import { assertCanonicalPackageRelativePath } from './skill-path.js'
import type { SkillEntry } from '../shared/types.js'
import type { ReadFs } from '../shared/utils.js'

export type IntentManifestCapability =
  | 'reads_project_files'
  | 'runs_install_command'
  | 'ships_scripts'
  | 'uses_network'
  | 'writes_project_files'

const MANIFEST_CAPABILITIES = new Set<IntentManifestCapability>([
  'reads_project_files',
  'runs_install_command',
  'ships_scripts',
  'uses_network',
  'writes_project_files',
])
const MCP_TOOL_FIELDS = new Set(['description', 'inputSchema', 'name'])
const MANIFEST_FIELDS = new Set([
  'manifestVersion',
  'package',
  'packageVersion',
  'skills',
])
const MANIFEST_SKILL_FIELDS = new Set([
  'capabilities',
  'contentHash',
  'declaredSecrets',
  'mcpTools',
  'name',
  'path',
])

export interface IntentManifestSkill {
  name: string
  path: string
  contentHash: string
  capabilities: Array<IntentManifestCapability>
  declaredSecrets: Array<string>
  mcpTools: Array<IntentManifestMcpTool>
}

export interface IntentManifestMcpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | Array<JsonValue>
  | { [key: string]: JsonValue }

export interface IntentManifest {
  manifestVersion: 1
  package: string
  packageVersion: string
  skills: Array<IntentManifestSkill>
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function toPosixPath(path: string): string {
  return path.split('\\').join('/')
}

// Deterministic: stable entry and key order with no generated timestamps.
export function serializeManifest(manifest: IntentManifest): string {
  return `${JSON.stringify(canonicalManifest(manifest), null, 2)}\n`
}

function canonicalManifest(manifest: IntentManifest): IntentManifest {
  return {
    manifestVersion: manifest.manifestVersion,
    package: manifest.package,
    packageVersion: manifest.packageVersion,
    skills: manifest.skills
      .toSorted((a, b) => compareStrings(a.path, b.path))
      .map((skill) => ({
        name: skill.name,
        path: skill.path,
        contentHash: skill.contentHash,
        capabilities: skill.capabilities.toSorted(compareStrings),
        declaredSecrets: skill.declaredSecrets.toSorted(compareStrings),
        mcpTools: canonicalMcpTools(skill.mcpTools, 'mcpTools'),
      })),
  }
}

export function writeIntentManifest(
  filePath: string,
  manifest: IntentManifest,
): void {
  writeFileSync(filePath, serializeManifest(manifest))
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid intent.manifest.json: ${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid intent.manifest.json: ${label} must be a string.`)
  }
  return value
}

function assertNoUndeclaredFields(
  record: Record<string, unknown>,
  fields: ReadonlySet<string>,
  label: string,
): void {
  for (const field of Object.keys(record)) {
    if (!fields.has(field)) {
      throw new Error(
        `Invalid intent.manifest.json: ${label} contains undeclared field "${field}".`,
      )
    }
  }
}

function assertStringArray(value: unknown, label: string): Array<string> {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(
      `Invalid intent.manifest.json: ${label} must be an array of strings.`,
    )
  }
  return value
}

function assertCapabilities(
  value: unknown,
  label: string,
): Array<IntentManifestCapability> {
  const capabilities = assertStringArray(value, label)
  for (const capability of capabilities) {
    if (!MANIFEST_CAPABILITIES.has(capability as IntentManifestCapability)) {
      throw new Error(
        `Invalid intent.manifest.json: ${label} contains unknown capability "${capability}".`,
      )
    }
  }
  return capabilities as Array<IntentManifestCapability>
}

function canonicalJsonValue(value: unknown, label: string): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid intent.manifest.json: ${label} must be JSON-serializable.`,
      )
    }
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
  throw new Error(
    `Invalid intent.manifest.json: ${label} must be JSON-serializable.`,
  )
}

function canonicalMcpTools(
  value: unknown,
  label: string,
): Array<IntentManifestMcpTool> {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid intent.manifest.json: ${label} must be an array.`)
  }

  const tools = value.map((tool, index): IntentManifestMcpTool => {
    const record = assertRecord(tool, `${label}[${index}]`)
    for (const field of Object.keys(record)) {
      if (!MCP_TOOL_FIELDS.has(field)) {
        throw new Error(
          `Invalid intent.manifest.json: ${label}[${index}] contains undeclared field "${field}".`,
        )
      }
    }
    const name = assertString(record.name, `${label}[${index}].name`)
    const description =
      record.description === undefined
        ? undefined
        : assertString(record.description, `${label}[${index}].description`)
    const inputSchema =
      record.inputSchema === undefined
        ? undefined
        : canonicalJsonValue(
            assertRecord(record.inputSchema, `${label}[${index}].inputSchema`),
            `${label}[${index}].inputSchema`,
          )

    return {
      name,
      ...(description === undefined ? {} : { description }),
      ...(inputSchema === undefined
        ? {}
        : { inputSchema: inputSchema as Record<string, unknown> }),
    }
  })

  const sorted = tools.toSorted((a, b) => compareStrings(a.name, b.name))
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index - 1]!.name === sorted[index]!.name) {
      throw new Error(
        `Invalid intent.manifest.json: ${label} contains duplicate tool name "${sorted[index]!.name}".`,
      )
    }
  }
  return sorted
}

export function parseManifest(raw: unknown): IntentManifest {
  const record = assertRecord(raw, 'manifest')
  assertNoUndeclaredFields(record, MANIFEST_FIELDS, 'manifest')
  if (record.manifestVersion !== 1) {
    throw new Error('Invalid intent.manifest.json: manifestVersion must be 1.')
  }

  const skillsRaw = record.skills
  if (!Array.isArray(skillsRaw)) {
    throw new Error('Invalid intent.manifest.json: skills must be an array.')
  }

  const seenPaths = new Set<string>()
  const skills = skillsRaw.map((entry, index): IntentManifestSkill => {
    const skillRecord = assertRecord(entry, `skills[${index}]`)
    assertNoUndeclaredFields(
      skillRecord,
      MANIFEST_SKILL_FIELDS,
      `skills[${index}]`,
    )
    const path = assertString(skillRecord.path, `skills[${index}].path`)
    assertCanonicalPackageRelativePath(path, `manifest skills[${index}].path`)
    if (seenPaths.has(path)) {
      throw new Error(
        `Invalid intent.manifest.json: duplicate skill path "${path}".`,
      )
    }
    seenPaths.add(path)

    return {
      name: assertString(skillRecord.name, `skills[${index}].name`),
      path,
      contentHash: assertString(
        skillRecord.contentHash,
        `skills[${index}].contentHash`,
      ),
      capabilities: assertCapabilities(
        skillRecord.capabilities ?? [],
        `skills[${index}].capabilities`,
      ),
      declaredSecrets: assertStringArray(
        skillRecord.declaredSecrets ?? [],
        `skills[${index}].declaredSecrets`,
      ),
      mcpTools: canonicalMcpTools(
        skillRecord.mcpTools ?? [],
        `skills[${index}].mcpTools`,
      ),
    }
  })

  return {
    manifestVersion: 1,
    package: assertString(record.package, 'package'),
    packageVersion: assertString(record.packageVersion, 'packageVersion'),
    skills,
  }
}

export function assertManifestMatchesPackage(
  manifest: IntentManifest,
  packageRoot: string,
  packageName: string,
  packageVersion: string,
  skills: ReadonlyArray<SkillEntry>,
  fs: ReadFs = nodeReadFs,
): void {
  if (manifest.package !== packageName) {
    throw new Error(
      `intent.manifest.json package "${manifest.package}" does not match discovered package "${packageName}".`,
    )
  }
  if (manifest.packageVersion !== packageVersion) {
    throw new Error(
      `intent.manifest.json packageVersion "${manifest.packageVersion}" does not match discovered version "${packageVersion}".`,
    )
  }

  const expected = new Map(
    skills.map((skill) => {
      const path = toPosixPath(relative(packageRoot, skill.path))
      return [
        path,
        computeSkillFolderHash(dirname(skill.path), packageRoot, fs),
      ]
    }),
  )
  if (manifest.skills.length !== expected.size) {
    throw new Error(
      'intent.manifest.json skill set does not match discovered skills.',
    )
  }

  for (const skill of manifest.skills) {
    const expectedHash = expected.get(skill.path)
    if (!expectedHash) {
      throw new Error(
        `intent.manifest.json skill path "${skill.path}" does not match discovered skills.`,
      )
    }
    if (skill.contentHash !== expectedHash) {
      throw new Error(
        `intent.manifest.json skill hash for "${skill.path}" does not match installed content.`,
      )
    }
  }
}

export function readIntentManifest(
  filePath: string,
  fs: Pick<ReadFs, 'existsSync' | 'readFileSync'> = nodeReadFs,
): IntentManifest | null {
  if (!fs.existsSync(filePath)) return null

  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    throw new Error(
      `Failed to read intent.manifest.json at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  try {
    return parseManifest(JSON.parse(content))
  } catch (err) {
    throw new Error(
      `Invalid intent.manifest.json at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// Aggregate manifestHash carried on the lockfile's source entry: a hash of
// the manifest's own skills[] content, so a lockfile diff detects any
// manifest change (added/removed skill, capability change, hash change)
// without needing to store the whole manifest inline.
export function computeManifestHash(manifest: IntentManifest): string {
  const hash = createHash('sha256')
  hash.update(serializeManifest(manifest))
  return `sha256-${hash.digest('hex')}`
}
