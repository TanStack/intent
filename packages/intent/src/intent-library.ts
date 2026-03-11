#!/usr/bin/env node

import { computeSkillNameWidth, printSkillTree, printTable } from './display.js'
import { INSTALL_PROMPT } from './install-prompt.js'
import { scanLibrary } from './library-scanner.js'
import type { LibraryScanResult } from './library-scanner.js'

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
  console.log(
    `  Submit feedback on skill usage to help maintainers improve the skills.`,
  )
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
  console.log(INSTALL_PROMPT)
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
