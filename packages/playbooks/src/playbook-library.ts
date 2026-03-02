#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { release } from 'node:os'
import type { LibraryScanResult } from './library-scanner.js'
import { scanLibrary } from './library-scanner.js'

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(): Promise<void> {
  let result: LibraryScanResult
  try {
    result = await scanLibrary(process.argv[1])
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  if (result.packages.length === 0) {
    console.log('No playbook-enabled packages found.')
    if (result.warnings.length > 0) {
      console.log('\nWarnings:')
      for (const w of result.warnings) console.log(`  ⚠ ${w}`)
    }
    return
  }

  for (const pkg of result.packages) {
    const header = pkg.description
      ? `${pkg.name} v${pkg.version} — ${pkg.description}`
      : `${pkg.name} v${pkg.version}`
    console.log(header)

    for (const skill of pkg.skills) {
      const name = skill.name.padEnd(28)
      const desc = (skill.description || '').padEnd(52)
      console.log(`  ${name}${desc}${skill.path}`)
    }

    console.log()
  }

  if (result.warnings.length > 0) {
    console.log('Warnings:')
    for (const w of result.warnings) console.log(`  ⚠ ${w}`)
  }
}

function cmdInstall(): void {
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

  const prompt = `You are an AI assistant helping a developer set up skill-to-task mappings for their project.

Follow these steps in order:

1. CHECK FOR EXISTING MAPPINGS
   Search the project's agent config files (CLAUDE.md, AGENTS.md, .cursorrules,
   .github/copilot-instructions.md) for a block delimited by:
     <!-- playbook-skills:start -->
     <!-- playbook-skills:end -->
   - If found: show the user the current mappings and ask "What would you like to update?"
     Then skip to step 4 with their requested changes.
   - If not found: continue to step 2.

2. DISCOVER AVAILABLE SKILLS
   Run: playbook list
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

<!-- playbook-skills:start -->
# Skill mappings — when working in these areas, load the linked skill file into context.
skills:
  - task: "describe the task or code area here"
    load: "node_modules/package-name/skills/skill-name/SKILL.md"
<!-- playbook-skills:end -->

   Rules:
   - Use the user's own words for task descriptions
   - Include the exact path from \`playbook list\` output so agents can load it directly
   - Keep entries concise — this block is read on every agent task
   - Preserve all content outside the block tags unchanged`

  console.log('🚀 Playbook Install')
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

const USAGE = `TanStack Playbooks

Usage:
  playbook list        List all available skills from this library and its dependencies
  playbook install     Set up skill-to-task mappings in your agent config`

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
