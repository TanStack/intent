// Package-side manifest: `skills/intent.manifest.json`. Ships inside a
// published skill package and gives skill metadata a stable, hashable home
// separate from SKILL.md content. Not a second lockfile — it's a maintainer-
// authored description of what a package's skills are and declare, never a
// consumer approval record, and it never lives in the consumer root.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import {
  computeSkillFolderHash,
  readSkillFolderContents,
} from './lockfile/hash.js'
import { detectCapabilityHeuristics, findSecretMatches } from './secrets.js'
import { nodeReadFs } from '../shared/utils.js'
import { assertCanonicalPackageRelativePath } from './skill-path.js'
import type { SkillEntry } from '../shared/types.js'
import type { ReadFs } from '../shared/utils.js'

const MANIFEST_VERSION = 1

interface IntentManifestSkill {
  name: string
  path: string
  contentHash: string
  capabilities: Array<string>
  declaredSecrets: Array<string>
  mcpTools: Array<ManifestMcpTool>
}

interface ManifestMcpTool {
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

function hasNonEmptyScriptsDir(skillDir: string): boolean {
  const scriptsDir = join(skillDir, 'scripts')
  if (!existsSync(scriptsDir)) return false
  try {
    return readdirSync(scriptsDir).length > 0
  } catch {
    return false
  }
}

interface SecretFinding {
  skillPath: string
  patternName: string
}

export type GenerateManifestOutcome =
  | { ok: true; manifest: IntentManifest }
  | { ok: false; secretFindings: Array<SecretFinding> }

// Walks each skill's own folder, computes its content hash, and runs static
// heuristics to pre-fill capabilities. The maintainer reviews and edits the
// resulting file before committing — heuristics inform, they don't decide.
// Hard-fails (no partial manifest) if any hash-included file contains a
// literal secret value; a declared secret NAME belongs in declaredSecrets,
// never a value in skill content.
export function generateManifest(
  packageRoot: string,
  packageName: string,
  packageVersion: string,
  skills: ReadonlyArray<SkillEntry>,
): GenerateManifestOutcome {
  const secretFindings: Array<SecretFinding> = []
  const manifestSkills: Array<IntentManifestSkill> = []

  for (const skill of skills) {
    const skillDir = dirname(skill.path)
    const relativePath = toPosixPath(relative(packageRoot, skill.path))
    const folderContents = readSkillFolderContents(skillDir, packageRoot)
    const skillContent = folderContents.find(
      (entry) => entry.relativePath === 'SKILL.md',
    )
    if (!skillContent) {
      throw new Error(`Missing SKILL.md in "${relativePath}".`)
    }

    let hasSecret = false
    for (const entry of folderContents) {
      const matches = findSecretMatches(entry.content.toString('utf8'))
      if (matches.length > 0) {
        hasSecret = true
        const entryPath = toPosixPath(
          relative(packageRoot, join(skillDir, entry.relativePath)),
        )
        for (const match of matches) {
          secretFindings.push({
            skillPath: entryPath,
            patternName: match.name,
          })
        }
      }
    }
    if (hasSecret) {
      continue
    }

    const heuristics = detectCapabilityHeuristics(
      skillContent.content.toString('utf8'),
    )
    const capabilities: Array<string> = []
    if (heuristics.usesNetwork) capabilities.push('uses_network')
    if (heuristics.runsInstallCommand) capabilities.push('runs_install_command')
    if (hasNonEmptyScriptsDir(skillDir)) capabilities.push('ships_scripts')

    manifestSkills.push({
      name: skill.name,
      path: relativePath,
      contentHash: computeSkillFolderHash(skillDir, packageRoot),
      capabilities: capabilities.toSorted(compareStrings),
      declaredSecrets: [],
      mcpTools: [],
    })
  }

  if (secretFindings.length > 0) {
    return { ok: false, secretFindings }
  }

  return {
    ok: true,
    manifest: {
      manifestVersion: MANIFEST_VERSION,
      package: packageName,
      packageVersion,
      skills: manifestSkills.toSorted((a, b) => compareStrings(a.path, b.path)),
    },
  }
}

// Deterministic: stable entry order (by path, already sorted by
// generateManifest) and stable key order, no generated timestamps — a
// manifest regenerated from unchanged inputs serializes byte-identical.
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

function assertStringArray(value: unknown, label: string): Array<string> {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(
      `Invalid intent.manifest.json: ${label} must be an array of strings.`,
    )
  }
  return value
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
  if (typeof value === 'object' && value !== null) {
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
): Array<ManifestMcpTool> {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid intent.manifest.json: ${label} must be an array.`)
  }

  const tools = value.map((tool, index): ManifestMcpTool => {
    const record = assertRecord(tool, `${label}[${index}]`)
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
      capabilities: assertStringArray(
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
