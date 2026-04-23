import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readIntentArtifacts } from './artifact-coverage.js'
import { findSkillFiles, parseFrontmatter } from './utils.js'
import type {
  IntentArtifactSet,
  IntentArtifactSkill,
  SkillStaleness,
  StalenessReport,
  StalenessSignal,
} from './types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SkillMeta {
  name: string
  relName: string
  filePath: string
  libraryVersion?: string
  sources?: Array<string>
}

function classifyVersionDrift(
  oldVer: string,
  newVer: string,
): 'major' | 'minor' | 'patch' | null {
  if (oldVer === newVer) return null
  const oldParts = oldVer
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number)
  const newParts = newVer
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number)
  if ((newParts[0] ?? 0) > (oldParts[0] ?? 0)) return 'major'
  if ((newParts[1] ?? 0) > (oldParts[1] ?? 0)) return 'minor'
  if ((newParts[2] ?? 0) > (oldParts[2] ?? 0)) return 'patch'
  return null
}

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

function readLocalVersion(packageDir: string): string | null {
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
    return typeof pkgJson.version === 'string' ? pkgJson.version : null
  } catch {
    return null
  }
}

async function fetchNpmVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown>
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

async function fetchCurrentVersion(
  packageDir: string,
  packageName: string,
): Promise<string | null> {
  return readLocalVersion(packageDir) ?? (await fetchNpmVersion(packageName))
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

interface SyncState {
  library_version?: string
  skills?: Record<string, { sources_sha?: Record<string, string> }>
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function parseSyncState(value: unknown): SyncState | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  const parsed: SyncState = {}

  if (typeof raw.library_version === 'string') {
    parsed.library_version = raw.library_version
  }

  if (raw.skills && typeof raw.skills === 'object') {
    const skills: Record<string, { sources_sha?: Record<string, string> }> = {}

    for (const [skillName, skillValue] of Object.entries(raw.skills)) {
      if (!skillValue || typeof skillValue !== 'object') continue

      const sourcesSha = (skillValue as Record<string, unknown>).sources_sha
      if (sourcesSha !== undefined && !isStringRecord(sourcesSha)) continue

      skills[skillName] = {}
      if (sourcesSha) {
        skills[skillName]!.sources_sha = sourcesSha
      }
    }

    parsed.skills = skills
  }

  return parsed
}

function readSyncState(packageDir: string): SyncState | null {
  const statePath = join(packageDir, 'skills', 'sync-state.json')
  try {
    return parseSyncState(JSON.parse(readFileSync(statePath, 'utf8')))
  } catch {
    return null
  }
}

export function readPackageName(packageDir: string): string {
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    ) as {
      name?: unknown
    }
    return typeof pkgJson.name === 'string'
      ? pkgJson.name
      : relative(process.cwd(), packageDir) || 'unknown'
  } catch {
    return relative(process.cwd(), packageDir) || 'unknown'
  }
}

// ---------------------------------------------------------------------------
// Artifact signals
// ---------------------------------------------------------------------------

function normalizeFilePath(path: string): string {
  return resolve(path).split(sep).join('/')
}

function normalizeList(values: Array<string> | undefined): Array<string> {
  return [...new Set(values ?? [])].sort((a, b) => a.localeCompare(b))
}

function sameStringList(
  a: Array<string> | undefined,
  b: Array<string>,
): boolean {
  const left = normalizeList(a)
  const right = normalizeList(b)
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function artifactPackageMatches(
  artifact: IntentArtifactSkill,
  packageDir: string,
  packageName: string,
  artifactRoot: string,
): boolean {
  const relPackageDir = relative(artifactRoot, packageDir).split(sep).join('/')
  if (!relPackageDir || relPackageDir === '') return true

  if (artifact.packages.includes(packageName)) return true
  if (artifact.packages.includes(relPackageDir)) return true
  if (artifact.path?.startsWith(`${relPackageDir}/`)) return true

  return artifact.packages.length === 0 && artifact.path === undefined
}

function resolveArtifactSkillPaths(
  artifact: IntentArtifactSkill,
  packageDir: string,
  artifactRoot: string,
): Array<string> {
  if (!artifact.path) return []

  const candidatePaths = [
    isAbsolute(artifact.path)
      ? artifact.path
      : join(artifactRoot, artifact.path),
    isAbsolute(artifact.path) ? artifact.path : join(packageDir, artifact.path),
  ]

  if (artifact.package && artifact.path.startsWith('skills/')) {
    candidatePaths.push(join(artifactRoot, artifact.package, artifact.path))
  }

  return [...new Set(candidatePaths.map(normalizeFilePath))]
}

function findMatchingSkill(
  artifact: IntentArtifactSkill,
  skillMetas: Array<SkillMeta>,
  packageDir: string,
  artifactRoot: string,
): SkillMeta | null {
  const skillsByPath = new Map(
    skillMetas.map((skill) => [normalizeFilePath(skill.filePath), skill]),
  )

  for (const candidatePath of resolveArtifactSkillPaths(
    artifact,
    packageDir,
    artifactRoot,
  )) {
    const match = skillsByPath.get(candidatePath)
    if (match) return match
  }

  const skillsByName = new Map<string, SkillMeta>()
  for (const skill of skillMetas) {
    skillsByName.set(skill.name, skill)
    skillsByName.set(skill.relName, skill)
  }

  return (
    (artifact.slug ? skillsByName.get(artifact.slug) : undefined) ??
    (artifact.name ? skillsByName.get(artifact.name) : undefined) ??
    null
  )
}

function buildArtifactSignals({
  artifactRoot,
  artifacts,
  library,
  packageDir,
  skillMetas,
}: {
  artifactRoot: string
  artifacts: IntentArtifactSet | null
  library: string
  packageDir: string
  skillMetas: Array<SkillMeta>
}): Array<StalenessSignal> {
  if (!artifacts) return []

  const artifactFiles = new Map(
    [...artifacts.skillTrees, ...artifacts.domainMaps].map((file) => [
      file.path,
      file,
    ]),
  )

  const signals: Array<StalenessSignal> = artifacts.warnings.map((warning) => ({
    type: 'artifact-parse-warning',
    library,
    subject: warning.artifactPath,
    reasons: [warning.message],
    needsReview: true,
    artifactPath: warning.artifactPath,
  }))

  for (const artifact of artifacts.skills) {
    if (!artifactPackageMatches(artifact, packageDir, library, artifactRoot)) {
      continue
    }

    const subject = artifact.slug ?? artifact.name ?? artifact.path
    const matchingSkill = findMatchingSkill(
      artifact,
      skillMetas,
      packageDir,
      artifactRoot,
    )

    if (artifact.path && !matchingSkill) {
      signals.push({
        type: 'artifact-skill-missing',
        library,
        subject,
        reasons: [
          `artifact skill path does not resolve to a generated SKILL.md (${artifact.path})`,
        ],
        needsReview: true,
        artifactPath: artifact.artifactPath,
        skill: artifact.slug ?? artifact.name,
      })
      continue
    }

    if (!matchingSkill) continue

    if (
      matchingSkill.sources !== undefined &&
      artifact.sources.length > 0 &&
      !sameStringList(matchingSkill.sources, artifact.sources)
    ) {
      signals.push({
        type: 'artifact-source-drift',
        library,
        subject,
        reasons: ['artifact sources differ from SKILL.md frontmatter sources'],
        needsReview: true,
        artifactPath: artifact.artifactPath,
        skill: matchingSkill.name,
      })
    }

    const artifactVersion = artifactFiles.get(
      artifact.artifactPath,
    )?.libraryVersion
    if (
      artifactVersion &&
      matchingSkill.libraryVersion &&
      artifactVersion !== matchingSkill.libraryVersion
    ) {
      signals.push({
        type: 'artifact-library-version-drift',
        library,
        subject,
        reasons: [
          `artifact library.version (${artifactVersion}) differs from SKILL.md library_version (${matchingSkill.libraryVersion})`,
        ],
        needsReview: true,
        artifactPath: artifact.artifactPath,
        skill: matchingSkill.name,
      })
    }
  }

  return signals
}

function artifactCoversPackage(
  artifact: IntentArtifactSkill,
  packageDir: string,
  packageName: string,
  artifactRoot: string,
): boolean {
  const relPackageDir = relative(artifactRoot, packageDir).split(sep).join('/')
  return (
    artifact.packages.includes(packageName) ||
    artifact.packages.includes(relPackageDir) ||
    artifact.package === packageName ||
    artifact.package === relPackageDir ||
    artifact.path?.startsWith(`${relPackageDir}/`) === true
  )
}

function artifactIgnoresPackage(
  artifacts: IntentArtifactSet,
  packageDir: string,
  packageName: string,
  artifactRoot: string,
): boolean {
  const relPackageDir = relative(artifactRoot, packageDir).split(sep).join('/')
  return artifacts.ignoredPackages.some(
    (ignored) =>
      ignored.packageName === packageName ||
      ignored.packageName === relPackageDir,
  )
}

export function buildWorkspaceCoverageSignals({
  artifactRoot,
  artifacts,
  packageDirs,
}: {
  artifactRoot: string
  artifacts: IntentArtifactSet | null
  packageDirs: Array<string>
}): Array<StalenessSignal> {
  if (!artifacts) return []

  const signals: Array<StalenessSignal> = []
  for (const packageDir of packageDirs) {
    const packageName = readPackageName(packageDir)
    if (
      artifactIgnoresPackage(artifacts, packageDir, packageName, artifactRoot)
    ) {
      continue
    }

    const hasGeneratedSkill =
      findSkillFiles(join(packageDir, 'skills')).length > 0
    const hasArtifactCoverage = artifacts.skills.some((artifact) =>
      artifactCoversPackage(artifact, packageDir, packageName, artifactRoot),
    )

    if (hasGeneratedSkill || hasArtifactCoverage) continue

    signals.push({
      type: 'missing-package-coverage',
      library: packageName,
      subject: packageName,
      reasons: [
        'workspace package is not represented by generated skills or _artifacts coverage',
      ],
      needsReview: true,
      packageName,
      packageRoot: relative(artifactRoot, packageDir).split(sep).join('/'),
    })
  }

  return signals
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function checkStaleness(
  packageDir: string,
  packageName?: string,
  artifactRoot = packageDir,
): Promise<StalenessReport> {
  const skillsDir = join(packageDir, 'skills')
  const library = packageName ?? 'unknown'

  // Find all skills
  const skillFiles = findSkillFiles(skillsDir)
  const skillMetas: Array<SkillMeta> = skillFiles.map((filePath) => {
    const fm = parseFrontmatter(filePath)
    const relName = relative(skillsDir, filePath)
      .replace(/[/\\]SKILL\.md$/, '')
      .split(sep)
      .join('/')
    return {
      name: typeof fm?.name === 'string' ? fm.name : relName,
      relName,
      filePath,
      libraryVersion: fm?.library_version as string | undefined,
      sources: Array.isArray(fm?.sources)
        ? (fm.sources as Array<string>)
        : undefined,
    }
  })

  const artifacts = existsSync(join(artifactRoot, '_artifacts'))
    ? readIntentArtifacts(artifactRoot)
    : null

  // Get the version from frontmatter (use first skill that has it)
  const skillVersion =
    skillMetas.find((s) => s.libraryVersion)?.libraryVersion ?? null

  // Resolve current version: prefer local package.json, fall back to npm registry
  const currentVersion = await fetchCurrentVersion(packageDir, library)

  // Classify drift
  const versionDrift =
    skillVersion && currentVersion
      ? classifyVersionDrift(skillVersion, currentVersion)
      : null

  // Read sync state
  const syncState = readSyncState(packageDir)

  // Build per-skill staleness
  const skills: Array<SkillStaleness> = skillMetas.map((skill) => {
    const reasons: Array<string> = []

    // Version drift
    if (
      currentVersion &&
      skill.libraryVersion &&
      skill.libraryVersion !== currentVersion
    ) {
      reasons.push(
        `version drift (${skill.libraryVersion} → ${currentVersion})`,
      )
    }

    // Source SHA changes (from sync-state)
    const storedShas = syncState?.skills?.[skill.name]?.sources_sha ?? {}
    // We only flag if there are stored SHAs but we can't check remote
    // (actual remote checking requires GitHub API — deferred to agent)
    if (skill.sources && Object.keys(storedShas).length > 0) {
      // Mark sources as needing review — agent will do the actual comparison
      for (const source of skill.sources) {
        if (!storedShas[source]) {
          reasons.push(`new source (${source})`)
        }
      }
    }

    return {
      name: skill.name,
      reasons,
      needsReview: reasons.length > 0,
    }
  })

  return {
    library,
    currentVersion,
    skillVersion,
    versionDrift,
    skills,
    signals: buildArtifactSignals({
      artifactRoot,
      artifacts,
      library,
      packageDir,
      skillMetas,
    }),
  }
}
