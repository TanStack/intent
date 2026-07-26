import { relative } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { detectIntentAudience } from '../../shared/environment.js'
import {
  coreOptionsFromGlobalFlags,
  noticeOptionsFromGlobalFlags,
  printNotices,
  printWarnings,
} from '../support.js'
import {
  buildIntentSkillsBlock,
  resolveIntentSkillsBlockTargetPath,
  verifyIntentSkillsBlockFile,
  writeIntentSkillsBlock,
} from './guidance.js'
import type { GlobalScanFlags } from '../support.js'
import type { InstallerPrompter } from './consumer.js'
import type { IntentCoreOptions } from '../../core/index.js'
import type { ScanResult } from '../../shared/types.js'

export interface InstallCommandOptions extends GlobalScanFlags {
  dryRun?: boolean
  input?: boolean
  map?: boolean
}

export async function runInteractiveInstall({
  cwd,
  dryRun,
  prompts,
}: {
  cwd: string
  dryRun?: boolean
  prompts: InstallerPrompter
}): Promise<void> {
  const [
    { runConsumerInstall },
    { resolveProjectContext },
    { scanForIntents },
  ] = await Promise.all([
    import('./consumer.js'),
    import('../../core/project-context.js'),
    import('../../discovery/scanner.js'),
  ])
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  await runConsumerInstall({
    discovered: scanForIntents(root, { scope: 'local' }).packages,
    dryRun,
    prompts,
    root,
  })
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
  const coreOptions = coreOptionsFromGlobalFlags(options)
  const noticeOptions = noticeOptionsFromGlobalFlags(options)

  if (!options.map) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      fail(
        'Interactive installation requires a terminal. Run `intent install` in a TTY or use `intent install --map` or `intent install --no-input`.',
      )
    }
    const { createClackInstallerPrompter } = await import('./prompts.js')
    await runInteractiveInstall({
      cwd: process.cwd(),
      dryRun: options.dryRun,
      prompts: createClackInstallerPrompter(),
    })
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
  const snapshotNotices =
    result.status !== 'unchanged' &&
    generated.mappingCount > 0 &&
    detectIntentAudience() === 'human'
      ? [
          'The intent-skills block is a snapshot and does not update when dependencies change. Re-run `intent install --map` to regenerate it.',
        ]
      : []
  printNotices([...snapshotNotices, ...scanResult.notices], noticeOptions)
}
