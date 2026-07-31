import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { compileExcludePatterns } from '../../core/excludes.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { applySourcePolicy } from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import { fail } from '../../shared/cli-error.js'
import { detectIntentAudience } from '../../shared/environment.js'
import {
  coreOptionsFromGlobalFlags,
  noticeOptionsFromGlobalFlags,
  printNotices,
  printWarnings,
} from '../support.js'
import {
  SUPPORTED_MAP_TARGETS,
  buildIntentSkillsBlock,
  findExistingIntentSkillsBlockTargetPath,
  resolveMapTargetPath,
  writeVerifiedIntentSkillsBlock,
} from './guidance.js'
import {
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
  dryRun,
  prompts,
  root,
}: {
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
  })
}

export interface InstallCommandOptions extends GlobalScanFlags {
  dryRun?: boolean
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
  const coreOptions = coreOptionsFromGlobalFlags(options)
  const noticeOptions = noticeOptionsFromGlobalFlags(options)

  if (!options.map) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      fail(
        'Interactive installation requires a terminal. Run `intent install` in a TTY or use `intent install --map`.',
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

  let root = process.cwd()
  let projectRoot = root
  let scanResult: ScanResult | null = null
  let bootstrapWrites: {
    lockfile: IntentLockfile
    packageJsonPath: string
    updatedPackageJson: string
  } | null = null

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const context = resolveProjectContext({ cwd: process.cwd() })
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
          updatedPackageJson: updateIntentConsumerConfigText(packageJson, {
            skills: plan.skills,
            exclude: plan.exclude,
          }),
        }
      }
    }
  }

  scanResult ??= await scanIntentsOrFail(coreOptions)
  const generated = buildIntentSkillsBlock(scanResult)

  if (generated.mappingCount === 0) {
    printNoActionableSkills(
      scanResult.warnings,
      scanResult.notices,
      noticeOptions,
    )
    return
  }

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
      `Generated ${formatMappingCount(generated.mappingCount)} for ${formatTargetPath(targetPath)}.`,
    )
    console.log(generated.block)
    printWarnings(scanResult.warnings)
    printNotices(scanResult.notices, noticeOptions)
    return
  }

  const result = writeVerifiedIntentSkillsBlock({
    generated,
    root,
    targetPath,
    formatTargetLabel: formatTargetPath,
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
