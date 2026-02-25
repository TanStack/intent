#!/usr/bin/env node

/**
 * TanStack Playbooks — Skill Sync Script
 *
 * Detects stale skills, bumps frontmatter versions, and marks skills as synced.
 * Always scoped to a single library.
 *
 * Usage:
 *   node scripts/sync-skills.mjs <library>                          # detect staleness
 *   node scripts/sync-skills.mjs <library> --report                 # write staleness_report.yaml
 *   node scripts/sync-skills.mjs <library> --mark-synced [skills..] # mark skills as synced
 *   node scripts/sync-skills.mjs <library> --mark-synced --all      # mark all skills as synced
 *   node scripts/sync-skills.mjs <library> --bump-version <ver> [skills..]  # bump frontmatter version
 */

import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { execSync, execFileSync } from 'child_process'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYBOOKS_DIR = path.resolve('packages', 'playbooks')
const SKILLS_DIR = path.join(PLAYBOOKS_DIR, 'skills')
const TREE_GENERATOR_PATH = path.resolve('meta', 'tree-generator', 'SKILL.md')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a gh api command and return parsed JSON. */
function ghApi(endpoint) {
  try {
    const result = execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return JSON.parse(result)
  } catch (err) {
    return null
  }
}

/** Run a gh api GraphQL query and return parsed JSON. */
function ghGraphQL(query) {
  try {
    const result = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return JSON.parse(result)
  } catch {
    return null
  }
}

/** Get the git SHA of a local file (last commit that touched it). */
function getLocalGitSha(filePath) {
  try {
    return execSync(`git log -1 --format=%H -- "${filePath}"`, {
      encoding: 'utf8',
      cwd: path.resolve('.'),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/** Get the latest commit SHA for a file in a GitHub repo. */
function getRemoteFileSha(owner, repo, filePath) {
  const data = ghApi(`repos/${owner}/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1`)
  if (data && data.length > 0) return data[0].sha
  return null
}

/** Parse YAML frontmatter from a SKILL.md file. */
async function parseFrontmatter(filePath) {
  let content
  try {
    content = await fsp.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  try {
    const parsed = parseYaml(match[1])
    if (typeof parsed.description === 'string') {
      parsed.description = parsed.description.replace(/\s+/g, ' ').trim()
    }
    return parsed
  } catch {
    return null
  }
}

/** Rewrite library_version in a SKILL.md file's frontmatter. */
async function bumpFrontmatterVersion(filePath, newVersion) {
  let content
  try {
    content = await fsp.readFile(filePath, 'utf8')
  } catch {
    return false
  }
  const updated = content.replace(
    /(library_version:\s*['"]?)[^'"\n]+(["']?)/,
    `$1${newVersion}$2`,
  )
  if (updated === content) return false
  await fsp.writeFile(filePath, updated)
  return true
}

/** Collect skills from immediate child directories that contain SKILL.md. */
async function collectSkillsInDir(dirPath, namePrefix) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dirPath, e.name, 'SKILL.md')))
    .map((e) => ({
      name: path.join(namePrefix, e.name),
      filePath: path.join(dirPath, e.name, 'SKILL.md'),
    }))
}

/** Discover all skill directories for a library (up to two levels deep). */
async function discoverSkills(libDir) {
  const libPath = path.join(SKILLS_DIR, libDir)
  if (!fs.existsSync(path.join(libPath, 'SKILL.md'))) return []

  const topSkills = await collectSkillsInDir(libPath, libDir)
  const subSkillArrays = await Promise.all(
    topSkills.map((s) => collectSkillsInDir(path.dirname(s.filePath), s.name)),
  )
  return [...topSkills, ...subSkillArrays.flat()]
}

/** Read sync-state.json for a library. Returns null if not found. */
async function readSyncState(libDir) {
  const statePath = path.join(SKILLS_DIR, libDir, 'sync-state.json')
  try {
    const content = await fsp.readFile(statePath, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** Write sync-state.json for a library. */
async function writeSyncState(libDir, state) {
  const statePath = path.join(SKILLS_DIR, libDir, 'sync-state.json')
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2) + '\n')
}

/** Parse owner/repo from a source reference like 'TanStack/db:docs/overview.md'. */
function parseSourceRef(ref) {
  const match = ref.match(/^([^:]+):(.+)$/)
  if (!match) return null
  const [ownerRepo, filePath] = [match[1], match[2]]
  const parts = ownerRepo.split('/')
  if (parts.length !== 2) return null
  return { owner: parts[0], repo: parts[1], filePath }
}

/** Classify semver drift between two versions. */
function classifyVersionDrift(oldVer, newVer) {
  if (!oldVer || !newVer || oldVer === newVer) return null
  const oldParts = oldVer.replace(/[^0-9.]/g, '').split('.').map(Number)
  const newParts = newVer.replace(/[^0-9.]/g, '').split('.').map(Number)
  if (newParts[0] > oldParts[0]) return 'major'
  if (newParts[1] > oldParts[1]) return 'minor'
  if (newParts[2] > oldParts[2]) return 'patch'
  return null
}

/** Fetch the current version of a package from its source repo. */
function fetchCurrentVersion(owner, repo, packagePath) {
  // Try common package.json locations
  const paths = packagePath
    ? [packagePath]
    : [`packages/${repo}/package.json`, 'package.json']

  for (const p of paths) {
    const data = ghApi(`repos/${owner}/${repo}/contents/${encodeURIComponent(p)}`)
    if (data?.content) {
      const decoded = Buffer.from(data.content, 'base64').toString('utf8')
      try {
        const pkg = JSON.parse(decoded)
        if (pkg.version) return pkg.version
      } catch { /* try next */ }
    }
  }
  return null
}

/** Fetch changelog/release notes between two versions. */
function fetchChangelog(owner, repo, oldVersion, newVersion) {
  // Try to get releases between versions
  const releases = ghApi(`repos/${owner}/${repo}/releases?per_page=20`)
  if (!releases || !Array.isArray(releases)) return []

  return releases
    .filter((r) => {
      const tag = r.tag_name?.replace(/^v/, '')
      if (!tag) return false
      return tag > oldVersion && tag <= newVersion
    })
    .map((r) => ({ version: r.tag_name, body: r.body?.slice(0, 500) ?? '' }))
}

// ---------------------------------------------------------------------------
// Shared extracted helpers
// ---------------------------------------------------------------------------

/** Find source repo owner/repo from skill frontmatter. */
async function findSourceRepo(skills) {
  for (const skill of skills) {
    const fm = await parseFrontmatter(skill.filePath)
    if (fm?.source_repository) {
      const match = fm.source_repository.match(/github\.com\/([^/]+)\/([^/]+)/)
      if (match) return { owner: match[1], repo: match[2] }
    }
    if (fm?.sources?.length > 0) {
      const ref = parseSourceRef(fm.sources[0])
      if (ref) return { owner: ref.owner, repo: ref.repo }
    }
  }
  return null
}

/** Compute staleness reasons for a single skill. */
async function getSkillReasons(skill, state, treeGeneratorChanged, currentVersion) {
  const fm = await parseFrontmatter(skill.filePath)
  const reasons = []

  if (treeGeneratorChanged) reasons.push('tree-generator updated')

  const sources = fm?.sources ?? []
  const storedShas = state?.skills?.[skill.name]?.sources_sha ?? {}

  for (const source of sources) {
    const ref = parseSourceRef(source)
    if (!ref) continue
    const currentSha = getRemoteFileSha(ref.owner, ref.repo, ref.filePath)
    const storedSha = storedShas[ref.filePath]

    if (!storedSha) {
      reasons.push(`new source (${ref.filePath})`)
    } else if (currentSha && currentSha !== storedSha) {
      reasons.push(`source changed (${ref.filePath})`)
    }
  }

  if (currentVersion && fm?.library_version && fm.library_version !== currentVersion) {
    reasons.push(`version drift (${fm.library_version} → ${currentVersion})`)
  }

  const needsRegen = reasons.some((r) =>
    r.startsWith('source changed') || r.startsWith('tree-generator') || r.startsWith('new source'),
  )
  return { reasons, needsRegen, frontmatter: fm }
}

/** Classify all skills into stale vs current. */
async function classifySkills(skills, state, treeGeneratorChanged, currentVersion) {
  const staleSkills = []
  const currentSkills = []

  for (const skill of skills) {
    const result = await getSkillReasons(skill, state, treeGeneratorChanged, currentVersion)
    if (result.reasons.length > 0) {
      staleSkills.push({ ...skill, ...result })
    } else {
      currentSkills.push(skill)
    }
  }
  return { staleSkills, currentSkills }
}

/** Collect current remote source SHAs for a skill. */
async function collectSourceShas(skill) {
  const fm = await parseFrontmatter(skill.filePath)
  const sources = fm?.sources ?? []
  const sourcesSha = {}

  for (const source of sources) {
    const ref = parseSourceRef(source)
    if (!ref) continue
    const sha = getRemoteFileSha(ref.owner, ref.repo, ref.filePath)
    if (sha) sourcesSha[ref.filePath] = sha
  }
  return sourcesSha
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printVersionInfo(skillVersion, currentVersion, versionDrift, treeGeneratorChanged) {
  if (currentVersion && skillVersion) {
    const driftLabel = versionDrift ? ` (${versionDrift})` : ''
    if (versionDrift) {
      console.log(`  Library version: ${skillVersion} → ${currentVersion}${driftLabel}`)
    } else {
      console.log(`  Library version: ${skillVersion} (current)`)
    }
  }
  console.log(`  Tree-generator: ${treeGeneratorChanged ? 'CHANGED' : 'unchanged'}`)
}

function printSourceSummary(staleSkills) {
  const count = staleSkills.filter((s) =>
    s.reasons.some((r) => r.startsWith('source changed') || r.startsWith('new source')),
  ).length
  console.log(`  Source changes: ${count} skills affected`)
  console.log()
}

function printStalenessDetails(staleSkills, currentSkills, totalCount) {
  console.log(`  Stale skills (${staleSkills.length}/${totalCount}):`)
  for (const skill of staleSkills) {
    const label = skill.needsRegen ? '⚠' : '↑'
    console.log(`    ${label} ${skill.name.padEnd(30)} ${skill.reasons.join(', ')}`)
  }
  console.log()

  if (currentSkills.length > 0) {
    console.log(`  Current skills (${currentSkills.length}/${totalCount}):`)
    console.log(`    ${currentSkills.map((s) => s.name).join(', ')}`)
    console.log()
  }
}

function printRecommendations({ libDir, staleSkills, currentSkills, currentVersion, versionDrift }) {
  const regenSkills = staleSkills.filter((s) => s.needsRegen)
  const bumpOnlySkills = staleSkills.filter((s) => !s.needsRegen)

  if (regenSkills.length > 0) {
    console.log(`  Recommendation:`)
    console.log(`    ${regenSkills.length} skill(s) need regeneration (source/tree-generator changed)`)
    if (bumpOnlySkills.length > 0 || versionDrift) {
      console.log(`    ${bumpOnlySkills.length + currentSkills.length} skill(s) need version bump only`)
    }
    if (currentVersion && versionDrift) {
      console.log(`    Run: node scripts/sync-skills.mjs ${libDir} --bump-version ${currentVersion}`)
    }
  } else if (versionDrift) {
    console.log(`  Recommendation: version bump only (no source changes)`)
    console.log(`    Run: node scripts/sync-skills.mjs ${libDir} --bump-version ${currentVersion}`)
  }
}

function printChangelog(sourceOwner, sourceRepo, skillVersion, currentVersion, versionDrift) {
  if (!versionDrift || !skillVersion || !currentVersion) return

  const changelog = fetchChangelog(sourceOwner, sourceRepo, skillVersion, currentVersion)
  if (changelog.length === 0) return

  console.log(`\n  Changelog entries:`)
  for (const entry of changelog) {
    console.log(`    ${entry.version}:`)
    const lines = entry.body.split('\n').slice(0, 5)
    for (const line of lines) console.log(`      ${line}`)
    if (entry.body.split('\n').length > 5) console.log('      ...')
  }
}

async function writeStalenessReportFile(opts) {
  const report = {
    library: opts.libDir,
    source_repo: `${opts.sourceOwner}/${opts.sourceRepo}`,
    library_version_in_skills: opts.skillVersion,
    library_version_current: opts.currentVersion,
    tree_generator_changed: opts.treeGeneratorChanged ?? false,
    version_drift: opts.versionDrift,
    stale_skills: opts.staleSkills.map((s) => ({
      skill: s.name,
      reasons: s.reasons,
      needs_regeneration: s.needsRegen,
    })),
    current_skills: opts.currentSkills.map((s) => ({ skill: s.name })),
  }
  const reportPath = path.join(SKILLS_DIR, opts.libDir, 'staleness_report.yaml')
  await fsp.writeFile(reportPath, stringifyYaml(report))
  console.log(`\n  Report written to ${reportPath}`)
}

// ---------------------------------------------------------------------------
// Mode 1: Detect staleness
// ---------------------------------------------------------------------------

async function detectStaleness(libDir, writeReport) {
  const state = await readSyncState(libDir)
  const skills = await discoverSkills(libDir)

  if (skills.length === 0) {
    console.error(`Error: No skills found for library '${libDir}'`)
    process.exit(1)
  }

  const source = await findSourceRepo(skills)
  if (!source) {
    console.error(`Error: Could not determine source repository for '${libDir}'`)
    process.exit(1)
  }

  const { owner: sourceOwner, repo: sourceRepo } = source
  console.log(`🔍 Checking ${libDir} skills against ${sourceOwner}/${sourceRepo}...\n`)

  const currentTreeSha = getLocalGitSha(TREE_GENERATOR_PATH)
  const stateTreeSha = state?.tree_generator_sha
  const treeGeneratorChanged = currentTreeSha && stateTreeSha && currentTreeSha !== stateTreeSha

  const currentVersion = fetchCurrentVersion(sourceOwner, sourceRepo, `packages/${sourceRepo}/package.json`)
  const skillVersion = state?.library_version ?? null
  const versionDrift = classifyVersionDrift(skillVersion, currentVersion)

  printVersionInfo(skillVersion, currentVersion, versionDrift, treeGeneratorChanged)

  const { staleSkills, currentSkills } = await classifySkills(skills, state, treeGeneratorChanged, currentVersion)

  printSourceSummary(staleSkills)

  if (staleSkills.length === 0) {
    console.log('✓ All skills up to date')
    return
  }

  printStalenessDetails(staleSkills, currentSkills, skills.length)
  printRecommendations({ libDir, staleSkills, currentSkills, currentVersion, versionDrift })
  printChangelog(sourceOwner, sourceRepo, skillVersion, currentVersion, versionDrift)

  if (writeReport) {
    await writeStalenessReportFile({
      libDir, sourceOwner, sourceRepo, skillVersion, currentVersion,
      treeGeneratorChanged, versionDrift, staleSkills, currentSkills,
    })
  }
}

// ---------------------------------------------------------------------------
// Mode 2: Mark synced
// ---------------------------------------------------------------------------

async function markSynced(libDir, skillNames, markAll) {
  const skills = await discoverSkills(libDir)
  const state = (await readSyncState(libDir)) ?? {
    library: libDir,
    source_repo: '',
    library_version: '',
    tree_generator_sha: '',
    synced_at: '',
    skills: {},
  }

  const source = await findSourceRepo(skills)
  const toSync = markAll ? skills : skills.filter((s) => skillNames.includes(s.name))

  if (toSync.length === 0) {
    console.error('Error: No matching skills found to mark as synced')
    process.exit(1)
  }

  const currentTreeSha = getLocalGitSha(TREE_GENERATOR_PATH)
  const today = new Date().toISOString().split('T')[0]

  for (const skill of toSync) {
    state.skills[skill.name] = { sources_sha: await collectSourceShas(skill) }
    console.log(`✓ Marked ${skill.name} as synced`)
  }

  // Update top-level state
  if (source) state.source_repo = `${source.owner}/${source.repo}`
  const firstFm = await parseFrontmatter(toSync[0].filePath)
  if (firstFm?.library_version) state.library_version = firstFm.library_version
  if (currentTreeSha) state.tree_generator_sha = currentTreeSha
  state.synced_at = today

  await writeSyncState(libDir, state)
  console.log(`\n✓ sync-state.json updated (${toSync.length} skills)`)
}

// ---------------------------------------------------------------------------
// Mode 3: Bump version
// ---------------------------------------------------------------------------

async function bumpVersion(libDir, newVersion, skillNames) {
  const skills = await discoverSkills(libDir)
  const toBump = skillNames.length > 0
    ? skills.filter((s) => skillNames.includes(s.name))
    : skills

  if (toBump.length === 0) {
    console.error('Error: No matching skills found to bump')
    process.exit(1)
  }

  let bumped = 0
  for (const skill of toBump) {
    const success = await bumpFrontmatterVersion(skill.filePath, newVersion)
    if (success) {
      bumped++
      console.log(`✓ ${skill.name} → v${newVersion}`)
    } else {
      console.warn(`  Warning: Could not bump ${skill.name}`)
    }
  }

  // Update sync-state.json
  const state = await readSyncState(libDir)
  if (state) {
    state.library_version = newVersion
    state.synced_at = new Date().toISOString().split('T')[0]
    await writeSyncState(libDir, state)
  }

  console.log(`\n✓ ${bumped} skill(s) bumped to v${newVersion}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `TanStack Playbooks — Skill Sync

Usage:
  node scripts/sync-skills.mjs <library>                                # detect staleness
  node scripts/sync-skills.mjs <library> --report                       # detect + write report
  node scripts/sync-skills.mjs <library> --mark-synced [skills..]       # mark skills as synced
  node scripts/sync-skills.mjs <library> --mark-synced --all            # mark all as synced
  node scripts/sync-skills.mjs <library> --bump-version <ver> [skills..]  # bump frontmatter version

Examples:
  node scripts/sync-skills.mjs db
  node scripts/sync-skills.mjs db --mark-synced db/core db/react
  node scripts/sync-skills.mjs db --bump-version 0.6.0`

function requireGhCli() {
  try {
    execSync('gh --version', { stdio: 'pipe' })
  } catch {
    console.error('Error: The GitHub CLI (gh) is required.\nInstall it from: https://cli.github.com')
    process.exit(1)
  }
  try {
    execSync('gh auth status', { stdio: 'pipe' })
  } catch {
    console.error('Error: Not authenticated with GitHub. Run: gh auth login')
    process.exit(1)
  }
}

const libDir = process.argv[2]
const args = process.argv.slice(3)

if (!libDir || libDir.startsWith('--')) {
  console.log(USAGE)
  process.exit(libDir ? 1 : 0)
}

// Verify the library has skills
if (!fs.existsSync(path.join(SKILLS_DIR, libDir))) {
  console.error(`Error: No skills directory found for '${libDir}' at ${path.join(SKILLS_DIR, libDir)}`)
  process.exit(1)
}

requireGhCli()

if (args.includes('--mark-synced')) {
  const markAll = args.includes('--all')
  const skillNames = args.filter((a) => !a.startsWith('--'))
  await markSynced(libDir, skillNames, markAll)
} else if (args.includes('--bump-version')) {
  const bumpIdx = args.indexOf('--bump-version')
  const newVersion = args[bumpIdx + 1]
  if (!newVersion || newVersion.startsWith('--')) {
    console.error('Error: --bump-version requires a version argument')
    process.exit(1)
  }
  const skillNames = args.slice(bumpIdx + 2).filter((a) => !a.startsWith('--'))
  await bumpVersion(libDir, newVersion, skillNames)
} else {
  const writeReport = args.includes('--report')
  await detectStaleness(libDir, writeReport)
}
