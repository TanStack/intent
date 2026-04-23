import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  IntentArtifactCoverageIgnore,
  IntentArtifactFile,
  IntentArtifactSet,
  IntentArtifactSkill,
  IntentArtifactWarning,
} from './types.js'

type ArtifactKind = IntentArtifactFile['kind']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function detectArtifactKind(fileName: string): ArtifactKind | null {
  if (fileName.endsWith('skill_tree.yaml')) return 'skill-tree'
  if (fileName.endsWith('domain_map.yaml')) return 'domain-map'
  return null
}

function readArtifactYaml(
  artifactPath: string,
  warnings: Array<IntentArtifactWarning>,
): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = parseYaml(readFileSync(artifactPath, 'utf8'))
  } catch (err) {
    warnings.push({
      artifactPath,
      message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    })
    return null
  }

  if (!isRecord(parsed)) {
    warnings.push({
      artifactPath,
      message: 'Artifact YAML must contain an object at the top level',
    })
    return null
  }

  return parsed
}

function parseArtifactFile(
  artifactPath: string,
  kind: ArtifactKind,
  parsed: Record<string, unknown>,
): IntentArtifactFile {
  const library = isRecord(parsed.library) ? parsed.library : {}
  return {
    path: artifactPath,
    kind,
    libraryName: stringValue(library.name),
    libraryVersion: stringValue(library.version),
  }
}

function parseSkills(
  artifactPath: string,
  kind: ArtifactKind,
  parsed: Record<string, unknown>,
): Array<IntentArtifactSkill> {
  if (!Array.isArray(parsed.skills)) return []

  const skills: Array<IntentArtifactSkill> = []
  for (const skill of parsed.skills) {
    if (!isRecord(skill)) continue

    const packagePath = stringValue(skill.package)
    const packages = stringArray(skill.packages)
    if (packagePath) {
      packages.push(packagePath)
    }

    skills.push({
      artifactPath,
      artifactKind: kind,
      name: stringValue(skill.name),
      slug: stringValue(skill.slug),
      path: stringValue(skill.path),
      package: packagePath,
      packages: [...new Set(packages)].sort((a, b) => a.localeCompare(b)),
      sources: stringArray(skill.sources),
      covers: stringArray(skill.covers),
    })
  }

  return skills
}

function parseCoverageIgnores(
  artifactPath: string,
  parsed: Record<string, unknown>,
): Array<IntentArtifactCoverageIgnore> {
  const coverage = isRecord(parsed.coverage) ? parsed.coverage : null
  const ignored = coverage?.ignored_packages
  if (!Array.isArray(ignored)) return []

  const ignores: Array<IntentArtifactCoverageIgnore> = []
  for (const entry of ignored) {
    if (typeof entry === 'string') {
      if (entry.trim()) {
        ignores.push({ packageName: entry, artifactPath })
      }
      continue
    }

    if (!isRecord(entry)) continue
    const packageName = stringValue(entry.name)
    if (!packageName) continue

    ignores.push({
      packageName,
      reason: stringValue(entry.reason),
      artifactPath,
    })
  }

  return ignores
}

export function readIntentArtifacts(root: string): IntentArtifactSet | null {
  const artifactsDir = join(root, '_artifacts')
  if (!existsSync(artifactsDir)) return null

  const warnings: Array<IntentArtifactWarning> = []
  const skillTrees: Array<IntentArtifactFile> = []
  const domainMaps: Array<IntentArtifactFile> = []
  const skills: Array<IntentArtifactSkill> = []
  const ignoredPackages: Array<IntentArtifactCoverageIgnore> = []

  for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue

    const kind = detectArtifactKind(entry.name)
    if (!kind) continue

    const artifactPath = join(artifactsDir, entry.name)
    const parsed = readArtifactYaml(artifactPath, warnings)
    if (!parsed) continue

    const artifactFile = parseArtifactFile(artifactPath, kind, parsed)
    if (kind === 'skill-tree') {
      skillTrees.push(artifactFile)
    } else {
      domainMaps.push(artifactFile)
    }

    skills.push(...parseSkills(artifactPath, kind, parsed))
    ignoredPackages.push(...parseCoverageIgnores(artifactPath, parsed))
  }

  return {
    root,
    artifactsDir,
    skillTrees: skillTrees.sort((a, b) => a.path.localeCompare(b.path)),
    domainMaps: domainMaps.sort((a, b) => a.path.localeCompare(b.path)),
    skills: skills.sort((a, b) =>
      `${a.artifactPath}:${a.slug ?? a.name ?? ''}`.localeCompare(
        `${b.artifactPath}:${b.slug ?? b.name ?? ''}`,
      ),
    ),
    ignoredPackages: ignoredPackages.sort((a, b) =>
      a.packageName.localeCompare(b.packageName),
    ),
    warnings,
  }
}
