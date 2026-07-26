import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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
import type { SkillSelection } from './plan.js'
import type { IntentCoreOptions } from '../../core/index.js'
import type { ScanResult } from '../../shared/types.js'

async function runInstallWithPrompts({
  dryRun,
  prompts,
  root,
  selection,
}: {
  dryRun?: boolean
  prompts: InstallerPrompter
  root: string
  selection?: SkillSelection
}): Promise<void> {
  const [{ runConsumerInstall }, { scanForIntents }] = await Promise.all([
    import('./consumer.js'),
    import('../../discovery/scanner.js'),
  ])
  await runConsumerInstall({
    discovered: scanForIntents(root, { scope: 'local' }).packages,
    dryRun,
    prompts,
    root,
    selection,
  })
}

async function runDeclarativeInstall(
  options: InstallCommandOptions,
): Promise<void> {
  const { resolveProjectContext } =
    await import('../../core/project-context.js')
  const context = resolveProjectContext({ cwd: process.cwd() })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  let packageJson: string
  try {
    packageJson = readFileSync(join(root, 'package.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(`Non-interactive install requires package.json in ${root}.`)
    }
    throw error
  }
  const { readIntentLockfile } = await import('../../core/lockfile/lockfile.js')
  if (readIntentLockfile(join(root, 'intent.lock')).status === 'found') {
    const { runSyncCommand } = await import('../sync/command.js')
    await runSyncCommand({ ...options, cwd: root }, { review: 'fail' })
    return
  }
  const { hasExplicitIntentSkills, readIntentConsumerConfig } =
    await import('./config.js')
  const config = readIntentConsumerConfig(packageJson)
  if (!hasExplicitIntentSkills(packageJson)) {
    fail(
      'Non-interactive install requires an explicit package.json intent.skills array. Add intent.skills (use [] to deny all) before running `intent install --no-input`.',
    )
  }
  if (!config.install) {
    fail(
      'Non-interactive install requires an explicit valid package.json intent.install object. Configure intent.install.method and intent.install.targets before running `intent install --no-input`.',
    )
  }
  const install = config.install
  if (install.method === 'hooks' && install.targets.includes('github')) {
    fail(
      'Non-interactive install cannot bootstrap GitHub Copilot hooks because they require interactive approval for user-home access. Remove "github" from intent.install.targets or run `intent install` in a terminal.',
    )
  }
  const selection: SkillSelection = {
    mode: 'configured-policy',
    skills: config.skills,
    exclude: config.exclude,
  }
  const prompts: InstallerPrompter = {
    advisory: (message) => console.log(message),
    complete: (message) => console.log(message),
    selectMethod: () => Promise.resolve(install.method),
    selectTargets: () => Promise.resolve(install.targets),
    confirmSymlink: () => Promise.resolve(true),
    confirmUserScopeHooks: () => Promise.resolve(false),
    selectSkills: () => Promise.resolve(selection),
    confirmInstall: () => Promise.resolve('install'),
  }
  await runInstallWithPrompts({
    dryRun: options.dryRun,
    prompts,
    root,
    selection,
  })
}

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
  const { resolveProjectContext } =
    await import('../../core/project-context.js')
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  await runInstallWithPrompts({ dryRun, prompts, root })
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
  if (options.input === false) {
    await runDeclarativeInstall(options)
    return
  }

  const coreOptions = coreOptionsFromGlobalFlags(options)
  const noticeOptions = noticeOptionsFromGlobalFlags(options)

  if (!options.map) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      fail(
        'Interactive installation requires a terminal. Run `intent install` in a TTY, use `intent install --map`, or configure explicit package.json intent.skills and intent.install values before using `intent install --no-input`.',
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
