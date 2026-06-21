import { relative } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { detectIntentCommandPackageManager } from '../../shared/command-runner.js'
import {
  coreOptionsFromGlobalFlags,
  noticeOptionsFromGlobalFlags,
  printNotices,
  printWarnings,
} from '../support.js'
import {
  buildIntentSkillGuidanceBlock,
  buildIntentSkillsBlock,
  resolveIntentSkillsBlockTargetPath,
  verifyIntentSkillsBlockFile,
  writeIntentSkillsBlock,
} from './guidance.js'
import type { GlobalScanFlags } from '../support.js'
import type { IntentCoreOptions } from '../../core/index.js'
import type { ScanResult } from '../../shared/types.js'

export const INSTALL_PROMPT = `You are an AI assistant helping a developer set up skill-to-task mappings for their project.

Goal: create or update one agent config file with an intent-skills mapping block.

Hard rules:
- Do not report success until a file was created or updated, or an existing mapping block was confirmed.
- If skills are discovered and no mapping block exists, create AGENTS.md unless the user asks for another supported config file.
- If a mapping block already exists in a supported config file, update that file.
- Preserve all content outside the managed block unchanged.
- Store compact \`id\` values and runnable \`run\` commands in the managed block; do not write local paths.
- Never write absolute local file paths, node_modules paths, or package-manager-internal paths in the managed block.
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
   This scans project-local node_modules by default and outputs each package and skill's name,
   description, and source.
   If the user explicitly wants globally installed skills included, run:
   \`npx @tanstack/intent@latest list --global\`
   This works best in Node-compatible environments (npm, pnpm, Bun, or Deno npm interop
   with node_modules enabled).
   If no skills are found, do not create a config file. Report: "No intent-enabled skills found."

3. SCAN THE REPOSITORY
   Build a picture of the project's structure and patterns:
   - Read package.json for library dependencies
   - Survey the directory layout (src/, app/, routes/, components/, api/, etc.)
   - Note recurring patterns (routing, data fetching, auth, UI components, etc.)

   Mapping coverage rule:
   - Create mappings for all discovered actionable skills.
   - Do not omit an actionable skill only because the repo does not currently appear to use it.
   - Do not map reference, meta, maintainer, or maintainer-only skills by default.
   - Include slash-named sub-skills when no parent mapping exists, or when they describe distinct user tasks.
   - If the proposed block would exceed 12 mappings, show the full discovered list and ask which packages
     or skill groups to include before writing.
   - Add one fallback note telling the agent to run \`npx @tanstack/intent@latest list\` for less common local skills.

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
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@scope/package#skill-name"
    run: "npx @tanstack/intent@latest load @scope/package#skill-name"
    for: "describe the task or code area here"
<!-- intent-skills:end -->

   Rules:
   - Use the user's own words for \`for\` descriptions
   - Use compact \`id\` values in \`<package>#<skill>\` format
   - Include a \`run\` command that loads the matching \`id\`
   - Do not include machine-specific directories such as \`/Users/...\`, \`/home/...\`, \`/private/...\`,
     drive letters, temp workspace paths, \`.pnpm/\`, \`.bun/\`, or \`.yarn/\`.
   - Agents should run the \`run\` command before editing matching files
   - Keep entries concise - this block is read on every agent task
   - Preserve all content outside the block tags unchanged
   - If the user is on Deno, note that this setup is best-effort today and relies on npm interop

5. VERIFY AND REPORT
   Before reporting completion:
   - Confirm the target file exists
   - Confirm it contains both managed block markers
  - Confirm every mapping has \`id\`, \`run\`, and \`for\`
  - Confirm every \`id\` parses as \`<package>#<skill>\`
  - Confirm every \`run\` command loads the matching \`id\`
   - Confirm no path-like machine-specific values are stored in the managed block
   - Confirm every discovered actionable skill is mapped, skipped by rule, or deferred by user choice

   Final response must include:
   - The target file path
   - Whether it was created, updated, or already contained a valid block
   - The number of mappings
   - The verification result`

export interface InstallCommandOptions extends GlobalScanFlags {
  dryRun?: boolean
  map?: boolean
  printPrompt?: boolean
}

function formatTargetPath(targetPath: string): string {
  return relative(process.cwd(), targetPath) || targetPath
}

function formatMappingCount(mappingCount: number): string {
  return `${mappingCount} ${mappingCount === 1 ? 'mapping' : 'mappings'}`
}

function printNoActionableSkills(
  warnings: Array<string>,
  notices: Array<string>,
  noticeOptions: { noNotices?: boolean },
): void {
  console.log('No intent-enabled skills found.')
  printWarnings(warnings)
  printNotices(notices, noticeOptions)
}

function printPlacementTip(targetPath: string): void {
  console.log(
    `Tip: Keep the intent-skills block near the top of ${formatTargetPath(targetPath)} so agents read it before task-specific instructions.`,
  )
}

function printWriteResult({
  mappingCount,
  status,
  targetPath,
}: {
  mappingCount: number
  status: 'created' | 'unchanged' | 'updated'
  targetPath: string
}): void {
  const target = formatTargetPath(targetPath)

  if (mappingCount === 0) {
    switch (status) {
      case 'created':
        console.log(`Created ${target} with skill loading guidance.`)
        break
      case 'updated':
        console.log(`Updated ${target} with skill loading guidance.`)
        break
      case 'unchanged':
        console.log(
          `No changes to ${target}; skill loading guidance already current.`,
        )
        break
    }
    return
  }

  switch (status) {
    case 'created':
      console.log(`Created ${target} with ${formatMappingCount(mappingCount)}.`)
      break
    case 'updated':
      console.log(`Updated ${target} with ${formatMappingCount(mappingCount)}.`)
      break
    case 'unchanged':
      console.log(
        `No changes to ${target}; ${formatMappingCount(mappingCount)} already current.`,
      )
      break
  }
}

export async function runInstallCommand(
  options: InstallCommandOptions,
  scanIntentsOrFail: (coreOptions?: IntentCoreOptions) => Promise<ScanResult>,
): Promise<void> {
  if (options.printPrompt) {
    console.log(INSTALL_PROMPT)
    return
  }

  const coreOptions = coreOptionsFromGlobalFlags(options)
  const noticeOptions = noticeOptionsFromGlobalFlags(options)

  if (!options.map) {
    const generated = buildIntentSkillGuidanceBlock(
      detectIntentCommandPackageManager(),
    )

    if (options.dryRun) {
      const targetPath = resolveIntentSkillsBlockTargetPath(process.cwd(), 1)
      console.log(
        `Generated skill loading guidance for ${formatTargetPath(targetPath!)}.`,
      )
      console.log(generated.block)
      return
    }

    const result = writeIntentSkillsBlock({
      ...generated,
      root: process.cwd(),
      skipWhenEmpty: false,
    })

    if (!result.targetPath) {
      fail('Install guidance target was not created.')
    }

    const verification = verifyIntentSkillsBlockFile({
      expectedBlock: generated.block,
      targetPath: result.targetPath,
    })

    const target = formatTargetPath(result.targetPath)
    if (!verification.ok) {
      fail(
        [
          `Install verification failed for ${target}:`,
          ...verification.errors.map((error) => `- ${error}`),
        ].join('\n'),
      )
    }

    printWriteResult(result)
    printPlacementTip(result.targetPath)
    return
  }

  const scanResult = await scanIntentsOrFail(coreOptions)
  const generated = buildIntentSkillsBlock(scanResult)

  if (options.dryRun) {
    const targetPath = resolveIntentSkillsBlockTargetPath(
      process.cwd(),
      generated.mappingCount,
    )

    if (!targetPath) {
      printNoActionableSkills(
        scanResult.warnings,
        scanResult.notices,
        noticeOptions,
      )
      return
    }

    console.log(
      `Generated ${formatMappingCount(generated.mappingCount)} for ${formatTargetPath(targetPath)}.`,
    )
    console.log(generated.block)
    printWarnings(scanResult.warnings)
    printNotices(scanResult.notices, noticeOptions)
    return
  }

  const result = writeIntentSkillsBlock({
    ...generated,
    root: process.cwd(),
  })

  if (!result.targetPath) {
    printNoActionableSkills(
      scanResult.warnings,
      scanResult.notices,
      noticeOptions,
    )
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

  printWriteResult(result)
  printPlacementTip(result.targetPath)

  printWarnings(scanResult.warnings)
  printNotices(scanResult.notices, noticeOptions)
}
