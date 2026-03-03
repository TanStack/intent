#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { release } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { scanForIntents } from './scanner.js'
import type { ScanResult } from './types.js'
import { findSkillFiles, parseFrontmatter } from './utils.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMetaDir(): string {
  // Resolve relative to this file's location in dist/
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function padColumn(text: string, width: number): string {
  return text.length >= width ? text + '  ' : text.padEnd(width)
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map(
    (h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 2,
  )

  const headerLine = headers.map((h, i) => padColumn(h, widths[i]!)).join('')
  const separator = widths.map((w) => '─'.repeat(w)).join('')

  console.log(headerLine)
  console.log(separator)
  for (const row of rows) {
    console.log(row.map((cell, i) => padColumn(cell, widths[i]!)).join(''))
  }
}

interface SkillDisplay {
  name: string
  description: string
  type?: string
}

function printSkillTree(
  skills: SkillDisplay[],
  opts: { nameWidth: number; showTypes: boolean },
): void {
  const roots: string[] = []
  const children = new Map<string, SkillDisplay[]>()

  for (const skill of skills) {
    const slashIdx = skill.name.indexOf('/')
    if (slashIdx === -1) {
      roots.push(skill.name)
    } else {
      const parent = skill.name.slice(0, slashIdx)
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent)!.push(skill)
    }
  }

  if (roots.length === 0) {
    for (const skill of skills) {
      if (!roots.includes(skill.name)) roots.push(skill.name)
    }
  }

  for (const rootName of roots) {
    const rootSkill = skills.find((s) => s.name === rootName)
    if (!rootSkill) continue

    printSkillLine(rootName, rootSkill, 4, opts)

    for (const sub of children.get(rootName) ?? []) {
      const childName = sub.name.slice(sub.name.indexOf('/') + 1)
      printSkillLine(childName, sub, 6, opts)
    }
  }
}

function printSkillLine(
  displayName: string,
  skill: SkillDisplay,
  indent: number,
  opts: { nameWidth: number; showTypes: boolean },
): void {
  const nameStr = ' '.repeat(indent) + displayName
  const padding = ' '.repeat(Math.max(2, opts.nameWidth - nameStr.length))
  const typeCol = opts.showTypes
    ? (skill.type ? `[${skill.type}]` : '').padEnd(14)
    : ''
  console.log(`${nameStr}${padding}${typeCol}${skill.description}`)
}

function computeSkillNameWidth(allPackageSkills: SkillDisplay[][]): number {
  let max = 0
  for (const skills of allPackageSkills) {
    for (const s of skills) {
      const slashIdx = s.name.indexOf('/')
      const displayName = slashIdx === -1 ? s.name : s.name.slice(slashIdx + 1)
      const indent = slashIdx === -1 ? 4 : 6
      max = Math.max(max, indent + displayName.length)
    }
  }
  return max + 2
}

async function cmdList(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json')

  let result: ScanResult
  try {
    result = await scanForIntents()
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`)
      for (const w of result.warnings) console.log(`  ⚠ ${w}`)
    }
    return
  }

  const totalSkills = result.packages.reduce(
    (sum, p) => sum + p.skills.length,
    0,
  )
  console.log(
    `\n${result.packages.length} intent-enabled packages, ${totalSkills} skills (${result.packageManager})\n`,
  )

  // Summary table
  const rows = result.packages.map((pkg) => [
    pkg.name,
    pkg.version,
    String(pkg.skills.length),
    pkg.intent.requires?.join(', ') || '–',
  ])
  printTable(['PACKAGE', 'VERSION', 'SKILLS', 'REQUIRES'], rows)

  // Skills detail
  const allSkills = result.packages.map((p) => p.skills)
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.packages.some((p) => p.skills.some((s) => s.type))

  console.log(`\nSkills:\n`)
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name}`)
    printSkillTree(pkg.skills, { nameWidth, showTypes })
    console.log()
  }

  console.log(`Feedback:`)
  console.log(`  After completing your task, collect feedback on skill usage.`)
  console.log(
    `  Instructions: node_modules/@tanstack/intent/meta/feedback-collection/SKILL.md`,
  )
  console.log(
    `  Submit: npx intent feedback --submit --file intent-feedback.json`,
  )
  console.log()

  if (result.warnings.length > 0) {
    console.log(`Warnings:`)
    for (const w of result.warnings) console.log(`  ⚠ ${w}`)
  }
}

function cmdMeta(): void {
  const metaDir = getMetaDir()

  if (!existsSync(metaDir)) {
    console.error('Meta-skills directory not found.')
    process.exit(1)
  }

  const entries = readdirSync(metaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(metaDir, e.name, 'SKILL.md')))

  if (entries.length === 0) {
    console.log('No meta-skills found.')
    return
  }

  console.log('Meta-skills (for library maintainers):\n')

  for (const entry of entries) {
    const skillFile = join(metaDir, entry.name, 'SKILL.md')
    const fm = parseFrontmatter(skillFile)
    let description = ''
    if (typeof fm?.description === 'string') {
      description = fm.description.replace(/\s+/g, ' ').trim()
    }

    const shortDesc =
      description.length > 60 ? description.slice(0, 57) + '...' : description
    console.log(`  ${entry.name.padEnd(28)} ${shortDesc}`)
  }

  console.log(`\nUsage: load the SKILL.md into your AI agent conversation.`)
  console.log(`Path: node_modules/@tanstack/intent/meta/<name>/SKILL.md`)
}

function cmdValidate(args: string[]): void {
  const targetDir = args[0] ?? 'skills'
  const skillsDir = join(process.cwd(), targetDir)

  if (!existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`)
    process.exit(1)
  }

  interface ValidationError {
    file: string
    message: string
  }

  const errors: ValidationError[] = []
  const skillFiles = findSkillFiles(skillsDir)

  if (skillFiles.length === 0) {
    console.error('No SKILL.md files found')
    process.exit(1)
  }

  for (const filePath of skillFiles) {
    const rel = relative(process.cwd(), filePath)
    const content = readFileSync(filePath, 'utf8')
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/)

    if (!match) {
      errors.push({ file: rel, message: 'Missing or invalid frontmatter' })
      continue
    }

    if (!match[1]) {
      errors.push({ file: rel, message: 'Missing YAML frontmatter' })
      continue
    }

    let fm: Record<string, unknown>
    try {
      fm = parseYaml(match[1]) as Record<string, unknown>
    } catch {
      errors.push({ file: rel, message: 'Invalid YAML frontmatter' })
      continue
    }

    if (!fm.name)
      errors.push({ file: rel, message: 'Missing required field: name' })
    if (!fm.description)
      errors.push({ file: rel, message: 'Missing required field: description' })

    // Validate name matches directory path
    if (typeof fm.name === 'string') {
      const expectedPath = relative(skillsDir, filePath)
        .replace(/[/\\]SKILL\.md$/, '')
        .split(sep)
        .join('/')
      if (fm.name !== expectedPath) {
        errors.push({
          file: rel,
          message: `name "${fm.name}" does not match directory path "${expectedPath}"`,
        })
      }
    }

    // Framework skills must have requires
    if (fm.type === 'framework' && !Array.isArray(fm.requires)) {
      errors.push({
        file: rel,
        message: 'Framework skills must have a "requires" field',
      })
    }

    // Line count
    const lineCount = content.split(/\r?\n/).length
    if (lineCount > 500) {
      errors.push({
        file: rel,
        message: `Exceeds 500 line limit (${lineCount} lines)`,
      })
    }
  }

  const artifactsDir = join(skillsDir, '_artifacts')
  if (existsSync(artifactsDir)) {
    const requiredArtifacts = [
      'domain_map.yaml',
      'skill_spec.md',
      'skill_tree.yaml',
    ]

    for (const fileName of requiredArtifacts) {
      const artifactPath = join(artifactsDir, fileName)
      if (!existsSync(artifactPath)) {
        errors.push({
          file: relative(process.cwd(), artifactPath),
          message: 'Missing required artifact',
        })
        continue
      }

      const content = readFileSync(artifactPath, 'utf8')
      if (content.trim().length === 0) {
        errors.push({
          file: relative(process.cwd(), artifactPath),
          message: 'Artifact file is empty',
        })
        continue
      }

      if (fileName.endsWith('.yaml')) {
        try {
          parseYaml(content)
        } catch {
          errors.push({
            file: relative(process.cwd(), artifactPath),
            message: 'Invalid YAML in artifact file',
          })
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Validation failed with ${errors.length} error(s):\n`)
    for (const { file, message } of errors) {
      console.error(`  ${file}: ${message}`)
    }
    process.exit(1)
  }

  console.log(`✅ Validated ${skillFiles.length} skill files — all passed`)
}

function cmdScaffold(): void {
  function tryCopyToClipboard(text: string): boolean {
    const platform = process.platform
    const isWsl =
      platform === 'linux' &&
      (Boolean(process.env.WSL_DISTRO_NAME) ||
        Boolean(process.env.WSL_INTEROP) ||
        release().toLowerCase().includes('microsoft'))

    const tryCommand = (command: string, args: string[] = []) => {
      const result = spawnSync(command, args, { input: text })
      return result.status === 0
    }

    if (platform === 'darwin') return tryCommand('pbcopy')
    if (platform === 'win32') return tryCommand('clip')
    if (isWsl) return tryCommand('clip.exe')

    return (
      tryCommand('wl-copy') ||
      tryCommand('xclip', ['-selection', 'clipboard']) ||
      tryCommand('xsel', ['--clipboard', '--input'])
    )
  }

  const prompt = `You are an AI assistant helping a library maintainer scaffold Intent skills.
You MUST use the Intent meta skills in this exact order and follow their output requirements.

Before you start, ask the maintainer for their skills root path.
- Default: skills/
- If they choose a different path, replace "skills/" in all output paths below.

1) Meta skill: domain-discovery
   - Input: library name, repo URL, docs URL(s), scope constraints, target audience.
   - Output files (exact paths):
     - skills/_artifacts/domain_map.yaml
     - skills/_artifacts/skill_spec.md
   - These artifacts are maintainer-owned and should be committed to the repo.

2) Meta skill: tree-generator
   - Input: skills/_artifacts/domain_map.yaml + skills/_artifacts/skill_spec.md
   - Output file (exact path):
     - skills/_artifacts/skill_tree.yaml

3) Meta skill: generate-skill
   - Input: skills/_artifacts/skill_tree.yaml
   - Output files (exact path pattern):
     - skills/<domain>/<skill>/SKILL.md

Guidance for the maintainer:
- If any input is missing, ask for it.
- After each step, clearly tell the maintainer what files to create and where to save them.
- Do not skip steps.
- Use the library's actual terminology from docs and source.

At the end, produce a single Markdown feedback doc with three sections (Domain Discovery, Tree Generator, Generate Skill).
Ask if the maintainer wants to edit it, then ask if you should send it as a GitHub issue to TanStack/intent.
Use the issue title: [meta-feedback] intent meta skill.

Finish with a short checklist:
- Run npx intent validate
- Commit skills/ and skills/_artifacts/ (artifacts are repo-only)
- Exclude skills/_artifacts/ from package publishing
- Add README snippet: If you use an AI agent, run npx intent init
`

  console.log('🚀 Intent Scaffold Prompt')
  console.log('✨ Copy the prompt below into your AI agent:\n')
  console.log(prompt)

  const copied = tryCopyToClipboard(prompt)
  if (copied) {
    console.log('\n✅ Copied prompt to clipboard')
  } else {
    console.log('\n⚠ Tip: Manually copy the prompt above into your agent')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `TanStack Intent CLI

Usage:
  intent list [--json]           Discover intent-enabled packages
  intent meta                    List meta-skills for maintainers
  intent validate [<dir>]        Validate skill files (default: skills/)
  intent init                    Set up intent discovery in agent configs
  intent scaffold                Print maintainer scaffold prompt
  intent setup [--workflows] [--all]  Copy CI templates into your repo
  intent stale                   Check skills for staleness
  intent feedback --submit --file <path>           Submit skill feedback
  intent feedback --meta --submit --file <path>    Submit meta-skill feedback`

const command = process.argv[2]
const commandArgs = process.argv.slice(3)

switch (command) {
  case 'list':
    await cmdList(commandArgs)
    break
  case 'meta':
    cmdMeta()
    break
  case 'validate':
    cmdValidate(commandArgs)
    break
  case 'init': {
    const { runInit, detectAgentConfigs } = await import('./init.js')
    const initRoot = process.cwd()
    const result = runInit(initRoot)

    for (const f of result.injected) console.log(`✓ Added intent block to ${f}`)
    for (const f of result.skipped) console.log(`  Already present in ${f}`)
    for (const f of result.created) console.log(`✓ Created ${f}`)

    if (result.injected.length === 0 && result.skipped.length === 0) {
      const detected = detectAgentConfigs(initRoot)
      if (detected.length === 0) {
        console.log(
          'No agent config files found (AGENTS.md, CLAUDE.md, .cursorrules, .github/copilot-instructions.md).',
        )
        console.log('Create one of these files and run intent init again.')
      }
    }

    console.log(`✓ Config: ${result.configPath}`)
    break
  }
  case 'scaffold': {
    cmdScaffold()
    break
  }
  case 'stale': {
    const { checkStaleness } = await import('./staleness.js')
    const { scanForIntents: scanStale } = await import('./scanner.js')
    let staleResult
    try {
      staleResult = await scanStale()
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }

    if (staleResult.packages.length === 0) {
      console.log('No intent-enabled packages found.')
      break
    }

    const jsonStale = commandArgs.includes('--json')
    const reports = await Promise.all(
      staleResult.packages.map((pkg) => {
        const pkgDir = join(process.cwd(), 'node_modules', pkg.name)
        return checkStaleness(pkgDir, pkg.name)
      }),
    )

    if (jsonStale) {
      console.log(JSON.stringify(reports, null, 2))
      break
    }

    for (const report of reports) {
      const driftLabel = report.versionDrift
        ? ` [${report.versionDrift} drift]`
        : ''
      const vLabel =
        report.skillVersion && report.currentVersion
          ? ` (${report.skillVersion} → ${report.currentVersion})`
          : ''
      console.log(`${report.library}${vLabel}${driftLabel}`)

      const stale = report.skills.filter((s) => s.needsReview)
      if (stale.length === 0) {
        console.log('  All skills up-to-date')
      } else {
        for (const skill of stale) {
          console.log(`  ⚠ ${skill.name}: ${skill.reasons.join(', ')}`)
        }
      }
      console.log()
    }
    break
  }
  case 'feedback': {
    const { runFeedback } = await import('./feedback.js')
    runFeedback(commandArgs)
    break
  }
  case 'setup': {
    const { runSetup } = await import('./setup.js')
    runSetup(process.cwd(), getMetaDir(), commandArgs)
    break
  }
  default:
    console.log(USAGE)
    process.exit(command ? 1 : 0)
}
