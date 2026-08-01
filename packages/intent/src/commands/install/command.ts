import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { compileExcludePatterns } from '../../core/excludes.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import {
  readIntentLockfile,
  writeIntentLockfile,
} from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { applySourcePolicy } from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import { fail } from '../../shared/cli-error.js'
import {
  coreOptionsFromGlobalFlags,
  noticeOptionsFromGlobalFlags,
  printNotices,
  printWarnings,
} from '../support.js'
import {
  SUPPORTED_MAP_TARGETS,
  buildIntentSkillGuidanceBlock,
  buildIntentSkillsBlock,
  findExistingIntentSkillsBlockTargetPath,
  resolveMapTargetPath,
  writeVerifiedIntentSkillsBlock,
} from './guidance.js'
import {
  hasIntentDevDependency,
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from './config.js'
import { buildSkillSelectionPlan } from './plan.js'
import type { GlobalScanFlags } from '../support.js'
import type { InstallerPrompter } from './consumer.js'
import type { IntentLockfile } from '../../core/lockfile/lockfile.js'
import type { IntentCoreOptions } from '../../core/index.js'
import type { ScanResult } from '../../shared/types.js'

async function runInstallWithPrompts({
  debug,
  dryRun,
  prompts,
  root,
}: {
  debug?: boolean
  dryRun?: boolean
  prompts: InstallerPrompter
  root: string
}): Promise<void> {
  const [{ runConsumerInstall }, { createIntentFsCache }, { scanForIntents }] =
    await Promise.all([
      import('./consumer.js'),
      import('../../discovery/fs-cache.js'),
      import('../../discovery/scanner.js'),
    ])
  const fsCache = createIntentFsCache()
  const scanOptions = { scope: 'local' as const, fsCache }
  const scan = scanForIntents(root, scanOptions)
  await runConsumerInstall({
    discovered: scan.packages,
    dryRun,
    packageManager: scan.packageManager,
    prompts,
    readFs: fsCache.getReadFs(),
    root,
    warnings: getInstallWarnings(scan, debug),
  })
}

export interface InstallCommandOptions extends GlobalScanFlags {
  dryRun?: boolean
  map?: boolean
}

export async function runInteractiveInstall({
  cwd,
  debug,
  dryRun,
  prompts,
}: {
  cwd: string
  debug?: boolean
  dryRun?: boolean
  prompts: InstallerPrompter
}): Promise<void> {
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  await runInstallWithPrompts({ debug, dryRun, prompts, root })
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

function getInstallWarnings(scan: ScanResult, debug = false): Array<string> {
  const conflictNames = new Set(
    scan.conflicts.map((conflict) => conflict.packageName),
  )
  const warnings = scan.warnings.filter(
    (warning) => ![...conflictNames].some((name) => warning.includes(name)),
  )
  for (const conflict of scan.conflicts) {
    const variants = conflict.variants
      .map((variant) => `${variant.version} at ${variant.packageRoot}`)
      .join(', ')
    warnings.push(
      debug
        ? `Multiple versions of ${conflict.packageName} are installed (${variants}); ${conflict.chosen.version} at ${conflict.chosen.packageRoot} will be used.`
        : `Multiple versions of ${conflict.packageName} are installed; ${conflict.chosen.version} will be used. Run with --debug to see package paths.`,
    )
  }
  return warnings
}

function printInstallWarnings(scan: ScanResult, debug = false): void {
  printWarnings(getInstallWarnings(scan, debug))
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
  if (options.global || options.globalOnly) {
    fail(
      '`intent install` does not support --global or --global-only. Global catalog support is not available.',
    )
  }
  const coreOptions = coreOptionsFromGlobalFlags(options)
  const noticeOptions = noticeOptionsFromGlobalFlags(options)
  const audience = process.env.INTENT_AUDIENCE?.trim().toLowerCase()
  const context = resolveProjectContext({ cwd: process.cwd() })
  const trustedRoot =
    context.workspaceRoot ?? context.packageRoot ?? context.cwd

  if (audience === 'agent') {
    const packageJsonPath = join(trustedRoot, 'package.json')
    const config = existsSync(packageJsonPath)
      ? readIntentConsumerConfig(readFileSync(packageJsonPath, 'utf8'))
      : { skills: [], exclude: [] }
    const hasCommittedTrust =
      readIntentLockfile(join(trustedRoot, 'intent.lock')).status === 'found' &&
      (config.skills.length > 0 || config.exclude.length > 0)

    if (!options.map || !hasCommittedTrust) {
      fail(
        'Pause and ask the user to run `intent install` interactively to approve skills and choose the delivery target. Do not continue installation automatically.',
      )
    }
  }

  if (!options.map) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      fail(
        'Interactive installation requires a terminal. Run `intent install` in a TTY or use `intent install --map`.',
      )
    }
    const { createClackInstallerPrompter } = await import('./prompts.js')
    await runInteractiveInstall({
      cwd: process.cwd(),
      debug: options.debug,
      dryRun: options.dryRun,
      prompts: createClackInstallerPrompter(),
    })
    return
  }

  let root = audience === 'agent' ? trustedRoot : process.cwd()
  let projectRoot = root
  let scanResult: ScanResult | null = null
  let bootstrapWrites: {
    lockfile: IntentLockfile
    packageJsonPath: string
    updatedPackageJson: string
  } | null = null

  if (process.stdin.isTTY && process.stdout.isTTY) {
    projectRoot = context.workspaceRoot ?? context.packageRoot ?? context.cwd
    const lockfilePath = join(projectRoot, 'intent.lock')
    const packageJsonPath = join(projectRoot, 'package.json')
    if (!existsSync(lockfilePath) && existsSync(packageJsonPath)) {
      const packageJson = readFileSync(packageJsonPath, 'utf8')
      const config = readIntentConsumerConfig(packageJson)
      if (
        config.skills.length === 0 &&
        config.exclude.length === 0 &&
        !options.global &&
        !options.globalOnly
      ) {
        root = projectRoot
        const [{ createIntentFsCache }, { scanForIntents }] = await Promise.all(
          [
            import('../../discovery/fs-cache.js'),
            import('../../discovery/scanner.js'),
          ],
        )
        const fsCache = createIntentFsCache()
        const scanOptions = { scope: 'local' as const, fsCache }
        const scan = scanForIntents(root, scanOptions)
        if (buildIntentSkillsBlock(scan).mappingCount === 0) {
          printNoActionableSkills(scan.warnings, scan.notices, noticeOptions)
          return
        }

        const { selectClackSkills } = await import('./prompts.js')
        const selection = await selectClackSkills(scan.packages)
        if (!selection) return

        const plan = buildSkillSelectionPlan(scan.packages, selection)
        const policy = applySourcePolicy(
          { packages: scan.packages },
          {
            config: parseSkillSources(plan.skills),
            excludeMatchers: compileExcludePatterns(plan.exclude),
          },
        )
        scanResult = { ...scan, packages: policy.packages }
        bootstrapWrites = {
          lockfile: {
            lockfileVersion: 1,
            sources: buildCurrentLockfileSources(
              policy.packages,
              fsCache.getReadFs(),
            ),
          },
          packageJsonPath,
          updatedPackageJson: updateIntentConsumerConfigText(
            packageJson,
            {
              skills: plan.skills,
              exclude: plan.exclude,
            },
            { materialize: true },
          ),
        }
      }
    }
  }

  scanResult ??= await scanIntentsOrFail(coreOptions)
  const mappingCount = buildIntentSkillsBlock(scanResult).mappingCount

  if (mappingCount === 0) {
    printNoActionableSkills(
      scanResult.warnings,
      scanResult.notices,
      noticeOptions,
    )
    return
  }
  const packageJsonPath = join(root, 'package.json')
  const intentDevDependency =
    existsSync(packageJsonPath) &&
    hasIntentDevDependency(readFileSync(packageJsonPath, 'utf8'))
  const generated = buildIntentSkillGuidanceBlock(
    scanResult.packageManager,
    intentDevDependency,
  )

  let existingTargetPath =
    root !== projectRoot
      ? findExistingIntentSkillsBlockTargetPath(projectRoot)
      : null
  if (existingTargetPath) {
    root = projectRoot
  } else {
    existingTargetPath = findExistingIntentSkillsBlockTargetPath(root)
  }
  let targetPath: string
  if (existingTargetPath) {
    targetPath = resolveMapTargetPath(root, relative(root, existingTargetPath))
  } else {
    let selectedTarget: string = SUPPORTED_MAP_TARGETS[0]
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const { selectClackMapTarget } = await import('./prompts.js')
      const selection = await selectClackMapTarget(root)
      if (!selection) return
      selectedTarget = selection
    }
    targetPath = resolveMapTargetPath(root, selectedTarget)
  }

  if (options.dryRun) {
    console.log(
      `Would write Intent catalog guidance to ${formatTargetPath(targetPath)}.`,
    )
    console.log('No files changed.')
    printInstallWarnings(scanResult, options.debug)
    printNotices(scanResult.notices, noticeOptions)
    return
  }

  const result = writeVerifiedIntentSkillsBlock({
    generated,
    root,
    targetPath,
    formatTargetLabel: formatTargetPath,
    verifyMappings: false,
  })

  if (!result.targetPath) return

  if (bootstrapWrites) {
    writeIntentLockfile(join(root, 'intent.lock'), bootstrapWrites.lockfile)
    writeTextFileAtomic(
      bootstrapWrites.packageJsonPath,
      bootstrapWrites.updatedPackageJson,
    )
  }

  printWriteResult(result)
  printPlacementTip(result.targetPath)

  printInstallWarnings(scanResult, options.debug)
  const snapshotNotices =
    result.status !== 'unchanged' && audience !== 'agent'
      ? [
          'The Intent guidance checks for a session catalog before loading matching skills.',
        ]
      : []
  printNotices([...snapshotNotices, ...scanResult.notices], noticeOptions)
}
