import { relative } from 'node:path'
import { fail } from '../cli-error.js'
import {
  printWarnings,
  scanOptionsFromGlobalFlags,
  type GlobalScanFlags,
} from '../cli-support.js'
import type { ScanOptions, ScanResult } from '../types.js'
import {
  buildIntentSkillsBlock,
  resolveIntentSkillsBlockTargetPath,
  verifyIntentSkillsBlockFile,
  writeIntentSkillsBlock,
} from './install-writer.js'

export const INSTALL_PROMPT = `You are an AI assistant helping a developer set up skill-to-task mappings for their project.

Goal: create or update one agent config file with an intent-skills mapping block.

Hard rules:
- Do not report success until a file was created or updated, or an existing mapping block was confirmed.
- If skills are discovered and no mapping block exists, create AGENTS.md unless the user asks for another supported config file.
- If a mapping block already exists in a supported config file, update that file.
- Preserve all content outside the managed block unchanged.
- Use only stable, repo-relative paths from \`npx @tanstack/intent@latest list\`; do not invent node_modules paths.
- Never write absolute local file paths in the managed block.
- Verify the target file before your final response.

Follow these steps in order:

1. CHECK FOR EXISTING MAPPINGS
   Search the project's agent config files (AGENTS.md, CLAUDE.md, .cursorrules,
   .github/copilot-instructions.md) for a block delimited by:
     <!-- intent-skills:start -->
     <!-- intent-skills:end -->
   - If found: show the user the current mappings, keep that file as the source of truth,
     and ask "What would you like to update?" Then skip to step 4 with their requested changes.
   - If not found: continue to step 2.

2. DISCOVER AVAILABLE SKILLS
   Run: \`npx @tanstack/intent@latest list\`
   This outputs each skill's name, description, full path, and whether it was found in
   project-local node_modules or accessible global node_modules.
   This works best in Node-compatible environments (npm, pnpm, Bun, or Deno npm interop
   with node_modules enabled).
   If no skills are found, do not create a config file. Report: "No intent-enabled skills found."

3. SCAN THE REPOSITORY
   Build a picture of the project's structure and patterns:
   - Read package.json for library dependencies
   - Survey the directory layout (src/, app/, routes/, components/, api/, etc.)
   - Note recurring patterns (routing, data fetching, auth, UI components, etc.)

   Mapping coverage rule:
   - Create mappings for all discovered top-level actionable skills.
   - Do not omit a top-level actionable skill only because the repo does not currently appear to use it.
   - Do not map reference-only, meta, or maintainer-only skills by default.
   - For sub-skills, include them only when they describe distinct user tasks not covered by the parent skill.
   - If the proposed block would exceed 12 mappings, show the full discovered list and ask which packages
     or skill groups to include before writing.
   - Add one fallback note telling the agent to run \`npx @tanstack/intent@latest list\` for less common skills.

   Based on the repository scan and the coverage rule, propose the skill-to-task mappings.
   For each one explain:
   - The task or code area (in plain language the user would recognise)
   - Which skill applies and why

   Then ask: "What other tasks do you commonly use AI coding agents for?
   I'll create mappings for those too."
   Also ask: "I'll default to AGENTS.md unless you want another supported config file.
   Do you have a preference?"

4. WRITE THE MAPPINGS BLOCK
   Once you have the full set of mappings, write or update the agent config file.
   - If you found an existing intent-skills block, update that file in place.
   - Otherwise prefer AGENTS.md by default, unless the user asked for another supported file.
   - Do not stop after discovery. If skills were found, the task is incomplete until this file exists
     and contains the managed block.

   Use this exact block:

<!-- intent-skills:start -->
# Skill mappings - when working in these areas, load the linked skill file into context.
skills:
  - task: "describe the task or code area here"
    load: "node_modules/package-name/skills/skill-name/SKILL.md"
<!-- intent-skills:end -->

   Rules:
   - Use the user's own words for task descriptions
   - Include the exact stable, repo-relative path from \`npx @tanstack/intent@latest list\` output so agents can load it directly
   - Paths should use the stable \`node_modules/<package-name>/skills/...\` format (no version numbers)
   - Do not include machine-specific directories such as \`/Users/...\`, \`/home/...\`, \`/private/...\`,
     drive letters, or temp workspace paths.
   - If a skill path from \`list\` is absolute or contains package-manager-internal directories
     (e.g. \`.pnpm/\`, \`.bun/\`) with version numbers, do NOT use it as \`load\`.
     Instead, add a comment telling the agent how to locate the skill at runtime:
       - task: "describe the task"
         # Runtime lookup only: run \`npx @tanstack/intent@latest list --json\`, find package "<package-name>" skill "<skill-name>", and load its reported path for this session. Do not copy the resolved path into this file.
   - Keep entries concise - this block is read on every agent task
   - Preserve all content outside the block tags unchanged
   - If the user is on Deno, note that this setup is best-effort today and relies on npm interop

5. VERIFY AND REPORT
   Before reporting completion:
   - Confirm the target file exists
   - Confirm it contains both managed block markers
   - Confirm every load path came from \`npx @tanstack/intent@latest list\` output, or uses a runtime lookup comment
   - Confirm no load path is absolute or machine-specific
   - Confirm every runtime lookup comment includes both package name and skill name
   - Confirm every discovered top-level actionable skill is mapped, skipped by rule, or deferred by user choice

   Final response must include:
   - The target file path
   - Whether it was created, updated, or already contained a valid block
   - The number of mappings
   - The verification result`

export interface InstallCommandOptions extends GlobalScanFlags {
  dryRun?: boolean
  printPrompt?: boolean
}

function formatTargetPath(targetPath: string): string {
  return relative(process.cwd(), targetPath) || targetPath
}

function formatMappingCount(mappingCount: number): string {
  return `${mappingCount} ${mappingCount === 1 ? 'mapping' : 'mappings'}`
}

export async function runInstallCommand(
  options: InstallCommandOptions,
  scanIntentsOrFail: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  if (options.printPrompt) {
    console.log(INSTALL_PROMPT)
    return
  }

  const scanResult = await scanIntentsOrFail(
    scanOptionsFromGlobalFlags(options),
  )
  const generated = buildIntentSkillsBlock(scanResult)

  if (options.dryRun) {
    const targetPath = resolveIntentSkillsBlockTargetPath(
      process.cwd(),
      generated.mappingCount,
    )

    if (!targetPath) {
      console.log('No top-level actionable intent skills found.')
      printWarnings(scanResult.warnings)
      return
    }

    console.log(
      `Generated ${formatMappingCount(generated.mappingCount)} for ${formatTargetPath(targetPath)}.`,
    )
    console.log(generated.block)
    printWarnings(scanResult.warnings)
    return
  }

  const result = writeIntentSkillsBlock({
    ...generated,
    root: process.cwd(),
  })

  if (!result.targetPath) {
    console.log('No top-level actionable intent skills found.')
    printWarnings(scanResult.warnings)
    return
  }

  const target = formatTargetPath(result.targetPath)
  const verification = verifyIntentSkillsBlockFile({
    expectedBlock: generated.block,
    expectedMappingCount: generated.mappingCount,
    targetPath: result.targetPath,
  })

  if (!verification.ok) {
    fail(
      [
        `Install verification failed for ${target}:`,
        ...verification.errors.map((error) => `- ${error}`),
      ].join('\n'),
    )
  }

  switch (result.status) {
    case 'created':
      console.log(
        `Created ${target} with ${formatMappingCount(result.mappingCount)}.`,
      )
      break
    case 'updated':
      console.log(
        `Updated ${target} with ${formatMappingCount(result.mappingCount)}.`,
      )
      break
    case 'unchanged':
      console.log(
        `No changes to ${target}; ${formatMappingCount(result.mappingCount)} already current.`,
      )
      break
  }

  printWarnings(scanResult.warnings)
}
