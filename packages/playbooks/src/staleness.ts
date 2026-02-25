import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { StalenessReport, SkillStaleness } from './types.js'
import { findSkillFiles, parseFrontmatter } from './utils.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SkillMeta {
  name: string
  filePath: string
  libraryVersion?: string
  sources?: string[]
}

function classifyVersionDrift(
  oldVer: string,
  newVer: string,
): 'major' | 'minor' | 'patch' | null {
  if (oldVer === newVer) return null
  const oldParts = oldVer.replace(/[^0-9.]/g, '').split('.').map(Number)
  const newParts = newVer.replace(/[^0-9.]/g, '').split('.').map(Number)
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
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)
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

function readSyncState(packageDir: string): SyncState | null {
  const statePath = join(packageDir, 'skills', 'sync-state.json')
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as SyncState
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
  const skillMetas: SkillMeta[] = skillFiles.map((filePath) => {
    const fm = parseFrontmatter(filePath)
    const relName = relative(skillsDir, filePath)
      .replace(/[/\\]SKILL\.md$/, '')
      .split(sep)
      .join('/')
    return {
      name: fm?.name as string ?? relName,
      filePath,
      libraryVersion: fm?.library_version as string | undefined,
      sources: Array.isArray(fm?.sources) ? fm.sources as string[] : undefined,
    }
  })

  // Get the version from frontmatter (use first skill that has it)
  const skillVersion = skillMetas.find((s) => s.libraryVersion)?.libraryVersion ?? null

  // Fetch current npm version
  const currentVersion = await fetchNpmVersion(library)

  // Classify drift
  const versionDrift = skillVersion && currentVersion
    ? classifyVersionDrift(skillVersion, currentVersion)
    : null

  // Read sync state
  const syncState = readSyncState(packageDir)

  // Build per-skill staleness
  const skills: SkillStaleness[] = skillMetas.map((skill) => {
    const reasons: string[] = []

    // Version drift
    if (currentVersion && skill.libraryVersion && skill.libraryVersion !== currentVersion) {
      reasons.push(`version drift (${skill.libraryVersion} → ${currentVersion})`)
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
