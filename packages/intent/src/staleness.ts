import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { findSkillFiles, parseFrontmatter } from './utils.js'
import type { SkillStaleness, StalenessReport } from './types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SkillMeta {
  name: string
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
// npm version fetching
// ---------------------------------------------------------------------------

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
        skills[skillName].sources_sha = sourcesSha
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function checkStaleness(
  packageDir: string,
  packageName?: string,
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
      filePath,
      libraryVersion: fm?.library_version as string | undefined,
      sources: Array.isArray(fm?.sources)
        ? (fm.sources as Array<string>)
        : undefined,
    }
  })

  // Get the version from frontmatter (use first skill that has it)
  const skillVersion =
    skillMetas.find((s) => s.libraryVersion)?.libraryVersion ?? null

  // Fetch current npm version
  const currentVersion = await fetchNpmVersion(library)

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
  }
}
