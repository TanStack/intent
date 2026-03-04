#!/usr/bin/env node

import type { LibraryScanResult } from './library-scanner.js'
import { scanLibrary } from './library-scanner.js'
// ---------------------------------------------------------------------------
// Display helpers
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
  path?: string
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
  if (skill.path) {
    console.log(`${' '.repeat(indent + 2)}${skill.path}`)
  }
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(): Promise<void> {
  let result: LibraryScanResult
  try {
    result = await scanLibrary(process.argv[1]!)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (result.warnings.length > 0) {
      console.log('\nWarnings:')
      for (const w of result.warnings) console.log(`  ⚠ ${w}`)
    }
    return
  }

  const totalSkills = result.packages.reduce(
    (sum, p) => sum + p.skills.length,
    0,
  )
  console.log(
    `\n${result.packages.length} intent-enabled packages, ${totalSkills} skills\n`,
  )

  // Summary table
  const rows = result.packages.map((pkg) => [
    pkg.name,
    pkg.version,
    String(pkg.skills.length),
  ])
  printTable(['PACKAGE', 'VERSION', 'SKILLS'], rows)

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
    `  Load: node_modules/@tanstack/intent/meta/feedback-collection/SKILL.md`,
  )
  console.log()

  if (result.warnings.length > 0) {
    console.log(`Warnings:`)
    for (const w of result.warnings) console.log(`  ⚠ ${w}`)
  }
}

function cmdInstall(): void {
  const prompt = `You are an AI assistant helping a developer set up skill-to-task mappings for their project.

Follow these steps in order:

1. CHECK FOR EXISTING MAPPINGS
   Search the project's agent config files (CLAUDE.md, AGENTS.md, .cursorrules,
   .github/copilot-instructions.md) for a block delimited by:
     <!-- intent-skills:start -->
     <!-- intent-skills:end -->
   - If found: show the user the current mappings and ask "What would you like to update?"
     Then skip to step 4 with their requested changes.
   - If not found: continue to step 2.

2. DISCOVER AVAILABLE SKILLS
   Run: intent list
   This outputs each skill's name, description, and full path — grouped by package.

3. SCAN THE REPOSITORY
   Build a picture of the project's structure and patterns:
   - Read package.json for library dependencies
   - Survey the directory layout (src/, app/, routes/, components/, api/, etc.)
   - Note recurring patterns (routing, data fetching, auth, UI components, etc.)

   Based on this, propose 3–5 skill-to-task mappings. For each one explain:
   - The task or code area (in plain language the user would recognise)
   - Which skill applies and why

   Then ask: "What other tasks do you commonly use AI coding agents for?
   I'll create mappings for those too."

4. WRITE THE MAPPINGS BLOCK
   Once you have the full set of mappings, write or update the agent config file
   (prefer CLAUDE.md; create it if none exists) with this exact block:

<!-- intent-skills:start -->
# Skill mappings — when working in these areas, load the linked skill file into context.
skills:
  - task: "describe the task or code area here"
    load: "node_modules/package-name/skills/skill-name/SKILL.md"
<!-- intent-skills:end -->

   Rules:
   - Use the user's own words for task descriptions
   - Include the exact path from \`intent list\` output so agents can load it directly
   - Keep entries concise — this block is read on every agent task
   - Preserve all content outside the block tags unchanged`

  console.log(prompt)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `TanStack Intent

Usage:
  intent list        List all available skills from this library and its dependencies
  intent install     Print a skill that guides your coding agent to scan the project
                     and set up skill-to-task mappings in your agent config`

const command = process.argv[2]

switch (command) {
  case 'list':
  case undefined:
    await cmdList()
    break
  case 'install':
    cmdInstall()
    break
  default:
    console.log(USAGE)
    process.exit(command ? 1 : 0)
}
