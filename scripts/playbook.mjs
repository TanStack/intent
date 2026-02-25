#!/usr/bin/env node

/**
 * TanStack Playbooks — Test CLI
 *
 * Standalone script for testing playbook commands locally.
 * Usage:
 *   node scripts/playbook.mjs list [--all] [--json]
 *   node scripts/playbook.mjs init
 *   node scripts/playbook.mjs feedback --submit [--file <path>]
 */

import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { execSync, execFileSync } from 'child_process'
import { parse as parseYaml } from 'yaml'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns the parsed object or null if no frontmatter block found.
 */
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
    // Flatten multi-line description scalars
    if (typeof parsed.description === 'string') {
      parsed.description = parsed.description.replace(/\s+/g, ' ').trim()
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Resolve the playbooks root and detect which mode we're in.
 * Returns { basePath, mode } where basePath points to the directory
 * containing package_map.yaml and skills/.
 */
function resolvePlaybooksRoot() {
  // Check for installed mode first (node_modules)
  const installedPath = path.resolve('node_modules', '@tanstack', 'playbooks')
  if (
    fs.existsSync(path.join(installedPath, 'package_map.yaml'))
  ) {
    return { basePath: installedPath, mode: 'installed' }
  }

  // Repo mode — walk up from cwd looking for package_map.yaml inside packages/playbooks
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, 'packages', 'playbooks')
    if (fs.existsSync(path.join(candidate, 'package_map.yaml'))) {
      return { basePath: candidate, mode: 'repo' }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return null
}

/**
 * Walk up from cwd looking for package.json and return its parsed content.
 */
function findPackageJson() {
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'))
      } catch {
        return null
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Read and parse package_map.yaml from the resolved basePath.
 */
async function readPackageMap(basePath) {
  const mapPath = path.join(basePath, 'package_map.yaml')
  const content = await fsp.readFile(mapPath, 'utf8')
  return parseYaml(content)
}

/**
 * Discover sub-skills (child dirs containing SKILL.md) for a skill directory.
 */
async function findSubSkills(skillsBase, skillDir) {
  const fullDir = path.join(skillsBase, skillDir)
  let entries
  try {
    entries = await fsp.readdir(fullDir, { withFileTypes: true })
  } catch {
    return []
  }
  const subs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const subSkillPath = path.join(fullDir, entry.name, 'SKILL.md')
    if (fs.existsSync(subSkillPath)) {
      subs.push({
        dirName: entry.name,
        skillDir: path.join(skillDir, entry.name),
        filePath: subSkillPath,
      })
    }
  }
  return subs
}

/**
 * Prompt the user with readline and return their answer.
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------

/** Discover all skill directories by scanning the skills/ tree. */
async function discoverAllSkillDirs(skillsBase) {
  const dirs = new Set()
  const libraries = await fsp.readdir(skillsBase, { withFileTypes: true }).catch(() => [])
  for (const lib of libraries) {
    if (!lib.isDirectory()) continue
    const libPath = path.join(skillsBase, lib.name)
    if (fs.existsSync(path.join(libPath, 'SKILL.md'))) {
      dirs.add(lib.name)
    }
    const children = await fsp.readdir(libPath, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      if (!child.isDirectory()) continue
      if (fs.existsSync(path.join(libPath, child.name, 'SKILL.md'))) {
        dirs.add(path.join(lib.name, child.name))
      }
    }
  }
  return dirs
}

/** Add dirs from package_map entries that match the project's installed deps. */
function addDirsFromDeps(dirs, packageMap, allDeps) {
  const map = packageMap?.package_map ?? {}
  for (const [pkgName, pkgDirs] of Object.entries(map)) {
    if (!allDeps[pkgName]) continue
    const dirList = Array.isArray(pkgDirs) ? pkgDirs : [pkgDirs]
    for (const d of dirList) dirs.add(d)
  }
}

/** Add composition skill dirs when all their requires are already matched. */
function addCompositionDirs(dirs, packageMap) {
  for (const comp of packageMap?.compositions ?? []) {
    if (!comp?.requires) continue
    if (comp.requires.every((r) => dirs.has(r)) && comp.skills) {
      for (const s of comp.skills) dirs.add(s)
    }
  }
}

/** Match skill directories from package.json deps against the package_map. */
function matchSkillDirsFromDeps(packageMap) {
  const pkg = findPackageJson()
  if (!pkg) {
    console.error(
      'Error: Could not find package.json. Run this from a project directory, or use --all to show all skills.',
    )
    process.exit(1)
  }

  const dirs = new Set()
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  addDirsFromDeps(dirs, packageMap, allDeps)
  addCompositionDirs(dirs, packageMap)
  for (const d of packageMap?.always_include ?? []) dirs.add(d)
  return dirs
}

/** Build structured skill data from a set of skill directories. */
async function buildSkillData(matchedDirs, skillsBase, pathPrefix) {
  const skills = []
  for (const dir of matchedDirs) {
    const skillFile = path.join(skillsBase, dir, 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      console.warn(`Warning: Skill directory '${dir}' not found, skipping`)
      continue
    }
    const fm = await parseFrontmatter(skillFile)
    if (!fm) {
      console.warn(`Warning: Could not parse frontmatter in ${dir}/SKILL.md, skipping`)
      continue
    }

    const subSkillEntries = await findSubSkills(skillsBase, dir)
    const subSkills = await Promise.all(
      subSkillEntries.map(async (sub) => {
        const subFm = await parseFrontmatter(sub.filePath)
        return {
          name: subFm?.name ?? sub.skillDir,
          description: subFm?.description ?? '',
          path: path.join(pathPrefix, sub.skillDir, 'SKILL.md'),
          dirName: sub.dirName,
        }
      }),
    )

    skills.push({
      name: fm.name ?? dir,
      description: fm.description ?? '',
      type: fm.type ?? '',
      library: fm.library ?? dir.split(path.sep)[0],
      library_version: fm.library_version ?? '',
      path: path.join(pathPrefix, dir, 'SKILL.md'),
      requires: fm.requires ?? [],
      framework: fm.framework ?? undefined,
      sub_skills: subSkills,
      _dir: dir,
    })
  }
  return skills
}

/** Get the display group name for a skill's library. */
function groupNameFor(library) {
  return library === 'tanstack' ? 'ECOSYSTEM' : library.toUpperCase()
}

/** Sort group names: library groups alphabetically, COMPOSITIONS and ECOSYSTEM last. */
function sortGroupNames(names) {
  const trailing = new Set(['ECOSYSTEM', 'COMPOSITIONS'])
  return names.sort((a, b) => {
    if (trailing.has(a) && !trailing.has(b)) return 1
    if (!trailing.has(a) && trailing.has(b)) return -1
    return a.localeCompare(b)
  })
}

/** Print a single skill entry with its sub-skills. */
function printSkillEntry(skill) {
  const desc = skill.description.length > 60
    ? skill.description.slice(0, 60) + '…'
    : skill.description
  console.log(`  ${skill.name.padEnd(28)} ${desc}`)
  console.log(`    → ${skill.path}`)
  if (skill.requires.length > 0) {
    console.log(`    (builds on: ${skill.requires.join(', ')})`)
  }
  if (skill.sub_skills.length > 0) {
    console.log('    sub-skills:')
    for (const sub of skill.sub_skills) {
      console.log(`      ${sub.dirName.padEnd(24)} → ${sub.path}`)
    }
  }
}

/** Group skills by library and print formatted output. */
function printSkillGroups(skills) {
  const groups = {}
  for (const skill of skills) {
    const name = groupNameFor(skill.library)
    if (!groups[name]) groups[name] = []
    groups[name].push(skill)
  }

  for (const groupName of sortGroupNames(Object.keys(groups))) {
    console.log(groupName)
    for (const skill of groups[groupName]) printSkillEntry(skill)
    console.log()
  }
}

async function cmdList(args) {
  const showAll = args.includes('--all')
  const asJson = args.includes('--json')

  const root = resolvePlaybooksRoot()
  if (!root) {
    console.error(
      'Error: Could not find package_map.yaml. Run this from the playbooks repo or from a project with @tanstack/playbooks installed.',
    )
    process.exit(1)
  }

  const { basePath, mode } = root
  const packageMap = await readPackageMap(basePath)
  const version = packageMap?.playbook?.version ?? 'unknown'
  const skillsBase = path.join(basePath, 'skills')
  const pathPrefix = mode === 'installed'
    ? path.join('node_modules', '@tanstack', 'playbooks', 'skills')
    : 'skills'

  const matchedDirs = showAll
    ? await discoverAllSkillDirs(skillsBase)
    : matchSkillDirsFromDeps(packageMap)

  const skills = await buildSkillData(matchedDirs, skillsBase, pathPrefix)

  if (asJson) {
    const output = skills.map(({ _dir, ...rest }) => rest)
    console.log(JSON.stringify(output, null, 2))
    return
  }

  console.log(`TanStack Playbooks v${version}`)
  if (showAll) {
    console.log('Showing all skills (not filtered by package.json)')
  }
  console.log()
  printSkillGroups(skills)
}

// ---------------------------------------------------------------------------
// Command: init
// ---------------------------------------------------------------------------

const PROMPT_BLOCK = `## TanStack Playbooks

This project uses TanStack Playbooks for AI coding agent skills.
At the start of each session, run:

  tanstack playbook list

This returns available skills with file paths based on installed
TanStack packages. Read skill files directly from the paths shown.
Use skill descriptions to decide which to load for the current task.

After using playbook skills during a session, generate a feedback
report. See the ecosystem router skill (tanstack/SKILL.md) for the
feedback format.`

async function cmdInit() {
  const configFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    '.cursorrules',
    '.github/copilot-instructions.md',
    '.windsurfrules',
  ]

  const found = configFiles.filter((f) => fs.existsSync(path.resolve(f)))

  if (found.length > 0) {
    console.log(`Found config files: ${found.join(', ')}`)
    console.log()
    console.log('How would you like to add the TanStack Playbooks prompt?')
    console.log()
    console.log(`  1. Add to detected config files (${found.join(', ')})`)
    console.log('  2. Copy to clipboard')
    console.log("  3. I'll add it manually")
    console.log()
    const choice = await prompt('Choose (1/2/3): ')

    if (choice === '1') {
      for (const f of found) {
        const filePath = path.resolve(f)
        await fsp.appendFile(filePath, '\n\n' + PROMPT_BLOCK + '\n')
        console.log(`✓ Added to ${f}`)
      }
    } else if (choice === '2') {
      copyToClipboard(PROMPT_BLOCK)
    } else {
      console.log()
      console.log(PROMPT_BLOCK)
    }
  } else {
    console.log('No agent config files detected in this directory.')
    console.log()
    console.log('How would you like to add the TanStack Playbooks prompt?')
    console.log()
    console.log('  1. Create AGENTS.md with the prompt block')
    console.log('  2. Copy to clipboard')
    console.log("  3. I'll add it manually")
    console.log()
    const choice = await prompt('Choose (1/2/3): ')

    if (choice === '1') {
      await fsp.writeFile(path.resolve('AGENTS.md'), PROMPT_BLOCK + '\n')
      console.log('✓ Created AGENTS.md')
    } else if (choice === '2') {
      copyToClipboard(PROMPT_BLOCK)
    } else {
      console.log()
      console.log(PROMPT_BLOCK)
    }
  }
}

function copyToClipboard(text) {
  try {
    const platform = process.platform
    if (platform === 'darwin') {
      execSync('pbcopy', { input: text })
    } else if (platform === 'win32') {
      execSync('clip', { input: text })
    } else {
      // Linux / WSL — try clip.exe (WSL), then xclip, then xsel
      let copied = false
      for (const cmd of ['clip.exe', 'xclip -selection clipboard', 'xsel --clipboard --input']) {
        try {
          execSync(cmd, { input: text, stdio: ['pipe', 'pipe', 'pipe'] })
          copied = true
          break
        } catch { /* try next */ }
      }
      if (!copied) throw new Error('No clipboard command available')
    }
    console.log('✓ Copied to clipboard')
  } catch {
    console.log()
    console.log(PROMPT_BLOCK)
    console.log()
    console.log('Copy the above text manually.')
  }
}

// ---------------------------------------------------------------------------
// Command: feedback
// ---------------------------------------------------------------------------

/** Verify that the gh CLI is installed and authenticated. */
function requireGhCli() {
  try {
    execSync('gh --version', { stdio: 'pipe' })
  } catch {
    console.error(
      'Error: The GitHub CLI (gh) is required for feedback submission.\nInstall it from: https://cli.github.com',
    )
    process.exit(1)
  }
  try {
    execSync('gh auth status', { stdio: 'pipe' })
  } catch {
    console.error('Error: Not authenticated with GitHub. Run: gh auth login')
    process.exit(1)
  }
}

/** Read feedback content from --file flag or stdin. */
async function readFeedbackContent(args) {
  const fileIdx = args.indexOf('--file')
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    const filePath = path.resolve(args[fileIdx + 1])
    try {
      return await fsp.readFile(filePath, 'utf8')
    } catch (err) {
      console.error(`Error: Could not read file '${args[fileIdx + 1]}': ${err.message}`)
      process.exit(1)
    }
  }
  const eofHint = process.platform === 'win32' ? 'Ctrl+Z' : 'Ctrl+D'
  console.log(`Paste your feedback report below, then press ${eofHint} to submit:`)
  return new Promise((resolve) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/** Extract skill names from feedback content (### headings and skill_name: lines). */
function extractSkillNames(content) {
  const names = []
  for (const line of content.split('\n')) {
    const heading = line.match(/^###\s+(.+)/)
    if (heading) { names.push(heading[1].trim()); continue }
    const field = line.match(/skill_name:\s*(.+)/)
    if (field) names.push(field[1].trim())
  }
  return names
}

/** Sanitize sensitive content: secrets, JWTs, user paths. Returns { text, redacted }. */
function sanitizeContent(content) {
  let redacted = false
  let text = content

  text = text.replace(
    /(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[:=]\s*.*/gi,
    (match) => { redacted = true; return match.replace(/[:=]\s*.*/, ': [REDACTED]') },
  )
  text = text.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    () => { redacted = true; return '[REDACTED_TOKEN]' },
  )
  text = text.replace(
    /(?:\/Users\/|\/home\/|C:\\Users\\)([^\s/\\]+)/gi,
    (match, username) => { redacted = true; return match.replace(username, '[USER]') },
  )
  return { text, redacted }
}

async function cmdFeedback(args) {
  if (!args.includes('--submit')) {
    console.error('Usage: node scripts/playbook.mjs feedback --submit [--file <path>]')
    process.exit(1)
  }

  requireGhCli()

  const raw = await readFeedbackContent(args)
  const content = raw.trim()
  if (!content) {
    console.error('Error: No feedback content provided.')
    process.exit(1)
  }

  if (!content.includes('skill_name:') && !content.match(/^###\s/m)) {
    console.warn(
      'Warning: No skill_name entries found in feedback. The feedback will still be submitted but may not be automatically triaged.',
    )
  }

  const skillNames = extractSkillNames(content)
  const libraries = [...new Set(
    skillNames.map((s) => s.split('/')[0]).filter((lib) => lib && lib !== 'tanstack'),
  )]

  let version = 'unknown'
  const root = resolvePlaybooksRoot()
  if (root) {
    try {
      const pm = await readPackageMap(root.basePath)
      version = pm?.playbook?.version ?? 'unknown'
    } catch { /* ignore */ }
  }

  const { text: sanitized, redacted } = sanitizeContent(content)
  if (redacted) {
    console.log('Note: Some potentially sensitive values were redacted before submission.')
  }

  const dryRun = args.includes('--dry-run')
  const dateStr = new Date().toISOString().split('T')[0]
  const skillLabel = skillNames.length > 0 ? skillNames.join(', ') : 'general'
  const title = `Feedback: ${skillLabel} — ${dateStr}`
  const body = `Playbook version: ${version}\n\n${sanitized}`
  const labels = ['feedback', 'auto-submitted', ...libraries]

  if (dryRun) {
    console.log('--- Dry Run ---')
    console.log(`Title: ${title}`)
    console.log(`Labels: ${labels.join(', ')}`)
    console.log(`Body:\n${body}`)
    return
  }

  const ghArgs = ['issue', 'create', '--repo', 'tanstack/playbooks', '--title', title, '--body', body]
  for (const l of labels) ghArgs.push('--label', l)

  try {
    const result = execFileSync('gh', ghArgs, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    console.log(`✓ Feedback submitted: ${result.trim()}`)
  } catch (err) {
    console.error(`Error submitting feedback: ${err.message}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `TanStack Playbooks — Test CLI

Usage:
  node scripts/playbook.mjs list [--all] [--json]
  node scripts/playbook.mjs init
  node scripts/playbook.mjs feedback --submit [--file <path>] [--dry-run]

Commands:
  list       Show available skills for this project
  init       Add playbook prompt to agent config files
  feedback   Submit a feedback report as a GitHub Issue`

const command = process.argv[2]
const args = process.argv.slice(3)

if (!command) {
  console.log(USAGE)
  process.exit(0)
}

switch (command) {
  case 'list':
    await cmdList(args)
    break
  case 'init':
    await cmdInit()
    break
  case 'feedback':
    await cmdFeedback(args)
    break
  default:
    console.error(`Unknown command: ${command}`)
    console.log()
    console.log(USAGE)
    process.exit(1)
}
