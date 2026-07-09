// Package-side manifest: `skills/intent.manifest.json`. Ships inside a
// published skill package and gives skill metadata a stable, hashable home
// separate from SKILL.md content. Not a second lockfile — it's a maintainer-
// authored description of what a package's skills are and declare, never a
// consumer approval record, and it never lives in the consumer root.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { computeSkillFolderHash } from './lockfile/hash.js'
import { detectCapabilityHeuristics, findSecretMatches } from './secrets.js'
import type { SkillEntry } from '../shared/types.js'

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
// Hard-fails (no partial manifest) if any skill body contains a literal
// secret value; a declared secret NAME belongs in declaredSecrets, never a
// value in the body.
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
    const content = readFileSync(skill.path, 'utf8')

    const matches = findSecretMatches(content)
    if (matches.length > 0) {
      for (const match of matches) {
        secretFindings.push({ skillPath: relativePath, patternName: match.name })
      }
      continue
    }

    const heuristics = detectCapabilityHeuristics(content)
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
  const canonical = {
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
        mcpTools: skill.mcpTools,
      })),
  }
  return `${JSON.stringify(canonical, null, 2)}\n`
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
    if (path.startsWith('/') || path.includes('..')) {
      throw new Error(
        `Invalid intent.manifest.json: skills[${index}].path must be package-relative without ".." segments.`,
      )
    }
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
      mcpTools: Array.isArray(skillRecord.mcpTools)
        ? (skillRecord.mcpTools as Array<ManifestMcpTool>)
        : [],
    }
  })

  return {
    manifestVersion: 1,
    package: assertString(record.package, 'package'),
    packageVersion: assertString(record.packageVersion, 'packageVersion'),
    skills,
  }
}

export function readIntentManifest(filePath: string): IntentManifest | null {
  if (!existsSync(filePath)) return null
  try {
    return parseManifest(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    return null
  }
}

// Aggregate manifestHash carried on the lockfile's source entry: a hash of
// the manifest's own skills[] content, so a lockfile diff detects any
// manifest change (added/removed skill, capability change, hash change)
// without needing to store the whole manifest inline.
export function computeManifestHash(manifest: IntentManifest): string {
  const hash = createHash('sha256')
  for (const skill of manifest.skills.toSorted((a, b) =>
    compareStrings(a.path, b.path),
  )) {
    hash.update(skill.path)
    hash.update('\0')
    hash.update(skill.contentHash)
    hash.update('\0')
    hash.update(skill.capabilities.toSorted(compareStrings).join(','))
    hash.update('\0')
  }
  return `sha256-${hash.digest('hex')}`
}
