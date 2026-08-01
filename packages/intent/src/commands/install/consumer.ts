import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileExcludePatterns } from '../../core/excludes.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import {
  readIntentLockfile,
  writeIntentLockfile,
} from '../../core/lockfile/lockfile.js'
import { applySourcePolicy } from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { runInstallHooks } from '../../hooks/install.js'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import { printWarnings } from '../../shared/cli-output.js'
import { nodeReadFs } from '../../shared/utils.js'
import { runSyncCommand } from '../sync/command.js'
import { hasNonNativeLinkSource, reconcileManagedLinks } from '../sync/links.js'
import { buildSyncLinkPlan } from '../sync/plan.js'
import { wireIntentSyncPrepare } from '../sync/prepare.js'
import { readInstallStateForLinks } from '../sync/state.js'
import { toProjectRelativePath } from '../sync/targets.js'
import {
  hasIntentDevDependency,
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from './config.js'
import {
  INSTALL_TARGETS,
  detectInstallTargets,
  readIntentDeliveryConfig,
  writeIntentDeliveryConfig,
} from './delivery.js'
import {
  buildInstallDeltaInventory,
  buildSkillSelectionPlan,
  summarizeInstallDeltaInventory,
} from './plan.js'
import {
  buildIntentSkillGuidanceBlock,
  buildIntentSkillsBlockFromPackages,
  findExistingIntentSkillsBlockTargetPath,
  resolveMapTargetPath,
  writeVerifiedIntentSkillsBlock,
} from './guidance.js'
import type { IntentConsumerConfig } from './config.js'
import type {
  DeliveryMethod,
  InstallMethod,
  InstallTarget,
  IntentDeliveryConfig,
} from './delivery.js'
import type { SkillSelection } from './plan.js'
import type { HookAgent } from '../../hooks/types.js'
import type { ReadFs } from '../../shared/utils.js'
import type { IntentPackage, ScanResult } from '../../shared/types.js'

export type InstallConfirmation = 'install' | 'back' | null

export interface InstallerPrompter {
  complete: (message: string) => void
  selectMethod: () => Promise<InstallMethod | null>
  selectMapTarget: (root: string) => Promise<string | null>
  selectTargets: (
    method: DeliveryMethod,
    detected: ReadonlyArray<InstallTarget>,
  ) => Promise<Array<InstallTarget> | null>
  confirmSymlink: () => Promise<boolean | null>
  confirmUserScopeHooks: () => Promise<boolean | null>
  selectSkills: (
    discovered: ReadonlyArray<IntentPackage>,
  ) => Promise<SkillSelection | null>
  confirmInstall: (confirmation: {
    config: IntentConsumerConfig
    delivery: IntentDeliveryConfig
    skillCount: number
  }) => Promise<InstallConfirmation>
}

export interface RunConsumerInstallOptions {
  copilotHome?: string
  discovered: ReadonlyArray<IntentPackage>
  dryRun?: boolean
  homeDir?: string
  packageManager: ScanResult['packageManager']
  prompts: InstallerPrompter
  readFs?: ReadFs
  root: string
  warnings?: ReadonlyArray<string>
}

function hookAgentForTarget(target: InstallTarget): HookAgent {
  switch (target) {
    case 'github':
      return 'copilot'
    case 'claude':
    case 'codex':
      return target
    default:
      throw new Error(
        `Install method "hooks" is not supported for "${target}".`,
      )
  }
}

function countSkills(entries: ReadonlyArray<{ skillCount: number }>): number {
  return entries.reduce((count, entry) => count + entry.skillCount, 0)
}

function installConfiguredHooks(
  root: string,
  targets: ReadonlyArray<InstallTarget>,
  homeDir: string | undefined,
  copilotHome: string | undefined,
): Array<HookAgent> {
  const agents = targets.map(hookAgentForTarget).join(',')
  return runInstallHooks({ agents, copilotHome, homeDir, root, scope: 'user' })
    .filter((result) => result.status !== 'skipped')
    .map((result) => result.agent)
}

export async function runConsumerInstall({
  copilotHome,
  discovered,
  dryRun = false,
  homeDir,
  packageManager,
  prompts,
  readFs = nodeReadFs,
  root,
  warnings = [],
}: RunConsumerInstallOptions): Promise<void> {
  const packageJsonPath = join(root, 'package.json')
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  const intentDevDependency = hasIntentDevDependency(packageJson)
  const existingConfig = readIntentConsumerConfig(packageJson)
  const existingLock = readIntentLockfile(join(root, 'intent.lock'))
  const delivery = readIntentDeliveryConfig(root)
  async function resolveSkillSelection(): Promise<{
    plan: ReturnType<typeof buildSkillSelectionPlan> | null
    config: IntentConsumerConfig
    skillCount: number
  } | null> {
    const hasCommittedTrust =
      existingLock.status === 'found' &&
      (existingConfig.skills.length > 0 || existingConfig.exclude.length > 0)
    const reusingCommittedTrust = !delivery && hasCommittedTrust
    const selection = reusingCommittedTrust
      ? null
      : await prompts.selectSkills(discovered)
    if (!reusingCommittedTrust && !selection) return null
    const plan = selection
      ? buildSkillSelectionPlan(discovered, selection)
      : null
    const config = plan
      ? { skills: plan.skills, exclude: plan.exclude }
      : existingConfig
    const skillCount = (plan?.packages ?? discovered).reduce(
      (count, pkg) =>
        count +
        pkg.skills.filter(
          (skill) => !('status' in skill) || skill.status === 'enabled',
        ).length,
      0,
    )
    return { plan, config, skillCount }
  }
  if (delivery) {
    const inventory = buildInstallDeltaInventory(
      discovered,
      buildCurrentLockfileSources(discovered, readFs),
      existingLock,
      existingConfig,
    )
    const summary = summarizeInstallDeltaInventory(inventory)
    const newDependencies = countSkills(summary.newDependencies)
    const newSkills = countSkills(summary.newSkills)
    const changed = countSkills(summary.changed)
    const hasChanges =
      newDependencies > 0 || newSkills > 0 || changed > 0 || summary.removed > 0
    if (!hasChanges && existingLock.status === 'found') {
      if (dryRun || delivery.method === 'symlink') {
        if (dryRun) {
          printWarnings([...warnings])
          console.log('No files changed.')
        }
        prompts.complete('Project is up to date.')
        return
      }
      const userScopeHooksAccepted = await prompts.confirmUserScopeHooks()
      if (userScopeHooksAccepted === null) return
      const installedAgents = userScopeHooksAccepted
        ? installConfiguredHooks(root, delivery.targets, homeDir, copilotHome)
        : []
      const repairedHooks =
        installedAgents.length > 0 ? ' Repaired configured hooks.' : ''
      const skippedHooks = userScopeHooksAccepted
        ? ''
        : ' Hooks were skipped because home-directory access was declined.'
      prompts.complete(`Project is up to date.${repairedHooks}${skippedHooks}`)
      return
    }
    console.log(
      `Install changes: ${newDependencies} new ${newDependencies === 1 ? 'dependency' : 'dependencies'}, ${newSkills} new ${newSkills === 1 ? 'skill' : 'skills'}, ${changed} changed, ${summary.removed} removed.`,
    )
  }
  for (;;) {
    const method = delivery ? delivery.method : await prompts.selectMethod()
    if (!method) return
    if (method === 'map') {
      if (discovered.every((pkg) => pkg.skills.length === 0)) {
        prompts.complete('No intent-enabled skills found.')
        return
      }
      const resolved = await resolveSkillSelection()
      if (!resolved) return
      const { config, skillCount } = resolved
      const policy = applySourcePolicy(
        { packages: [...discovered] },
        {
          config: parseSkillSources(config.skills),
          excludeMatchers: compileExcludePatterns(config.exclude),
        },
      )
      const mappingCount = buildIntentSkillsBlockFromPackages(
        policy.packages,
        packageManager,
      ).mappingCount
      if (mappingCount === 0) {
        prompts.complete('No intent-enabled skills found.')
        return
      }
      const generated = buildIntentSkillGuidanceBlock(
        packageManager,
        intentDevDependency,
      )

      const existingTargetPath = findExistingIntentSkillsBlockTargetPath(root)
      let targetPath: string
      if (existingTargetPath) {
        targetPath = existingTargetPath
      } else {
        const selectedTarget = await prompts.selectMapTarget(root)
        if (!selectedTarget) return
        targetPath = resolveMapTargetPath(root, selectedTarget)
      }
      const relativeTarget = toProjectRelativePath(root, targetPath)

      if (dryRun) {
        console.log(`Would write Intent catalog guidance to ${relativeTarget}.`)
        printWarnings([...warnings])
        console.log('No files changed.')
        prompts.complete('Dry run complete.')
        return
      }

      const result = writeVerifiedIntentSkillsBlock({
        generated,
        root,
        targetPath,
        formatTargetLabel: () => relativeTarget,
        verifyMappings: false,
      })
      if (!result.targetPath) return

      const updatedPackageJson = updateIntentConsumerConfigText(
        packageJson,
        config,
        { materialize: true },
      )
      if (updatedPackageJson !== packageJson) {
        writeTextFileAtomic(packageJsonPath, updatedPackageJson)
      }
      writeIntentLockfile(join(root, 'intent.lock'), {
        lockfileVersion: 1,
        sources: buildCurrentLockfileSources(policy.packages, readFs),
      })
      if (
        result.status !== 'unchanged' &&
        process.env.INTENT_AUDIENCE?.trim().toLowerCase() !== 'agent'
      ) {
        console.log(
          'The Intent guidance checks for a session catalog before loading matching skills.',
        )
      }
      prompts.complete(
        `Installed ${skillCount} ${skillCount === 1 ? 'skill' : 'skills'} to ${relativeTarget} as a static guidance block.`,
      )
      return
    }
    const targets = delivery
      ? delivery.targets
      : await prompts.selectTargets(method, detectInstallTargets(root))
    if (!targets || targets.length === 0) return
    if (!delivery && method === 'symlink') {
      const symlinkAccepted = await prompts.confirmSymlink()
      if (!symlinkAccepted) return
    }
    if (discovered.every((pkg) => pkg.skills.length === 0)) {
      prompts.complete('No intent-enabled skills found.')
      return
    }
    const resolved = await resolveSkillSelection()
    if (!resolved) return
    const { plan, config, skillCount } = resolved
    const deliveryConfig = { method, targets }
    const installation = {
      config,
      delivery: deliveryConfig,
      skillCount,
    }
    const confirmation = await prompts.confirmInstall(installation)
    if (confirmation === null) return
    if (confirmation === 'back') continue

    const updatedConsumerConfig = updateIntentConsumerConfigText(
      packageJson,
      installation.config,
      { materialize: true },
    )
    const updatedPackageJson =
      method === 'symlink' && intentDevDependency
        ? wireIntentSyncPrepare(updatedConsumerConfig)
        : updatedConsumerConfig
    const policy = applySourcePolicy(
      { packages: [...discovered] },
      {
        config: parseSkillSources(installation.config.skills),
        excludeMatchers: compileExcludePatterns(installation.config.exclude),
      },
    )
    const lockfile = {
      lockfileVersion: 1 as const,
      sources: buildCurrentLockfileSources(policy.packages, readFs),
    }
    if (method === 'symlink') {
      const linkPlan = buildSyncLinkPlan({
        config: installation.config,
        currentSources: lockfile.sources,
        discovered,
        lock: { status: 'found', lockfile },
        packages: policy.packages,
        root,
        targets,
      })
      if (hasNonNativeLinkSource(linkPlan.expected, readFs)) {
        throw new Error(
          'Archive-backed/PnP sources cannot use symlink delivery; use hooks instead by setting intent.install.method to "hooks".',
        )
      }
      const preflight = reconcileManagedLinks({
        root,
        dryRun: true,
        expected: linkPlan.expected,
        stateResult: readInstallStateForLinks(root),
      })
      if (preflight.conflicts.length > 0) {
        throw new Error(
          `Install target conflicts: ${preflight.conflicts
            .map((path) => toProjectRelativePath(root, path))
            .join(', ')}.`,
        )
      }
    }

    if (dryRun) {
      const labels = new Map(
        INSTALL_TARGETS.map((target) => [target.id, target.label]),
      )
      const targetLabels = targets.map((target) => labels.get(target) ?? target)
      console.log(
        `Would install ${installation.skillCount} ${installation.skillCount === 1 ? 'skill' : 'skills'} to ${targetLabels.join(', ')} using ${method}.`,
      )
      console.log(
        `Would update package.json intent configuration:\n${JSON.stringify(installation.config, null, 2)}`,
      )
      console.log(
        `Would write intent.lock with ${lockfile.sources.length} ${lockfile.sources.length === 1 ? 'source' : 'sources'}.`,
      )
      printWarnings([...warnings])
      console.log('No files changed.')
      prompts.complete('Dry run complete.')
      return
    }

    const userScopeHooksAccepted =
      method === 'hooks' ? await prompts.confirmUserScopeHooks() : false
    if (userScopeHooksAccepted === null) return

    if (updatedPackageJson !== packageJson) {
      writeTextFileAtomic(packageJsonPath, updatedPackageJson)
    }
    if (plan) {
      writeIntentLockfile(join(root, 'intent.lock'), lockfile)
    }
    writeIntentDeliveryConfig(root, deliveryConfig)
    if (method === 'symlink') {
      await runSyncCommand({ cwd: root }, { review: 'reminder' })
      prompts.complete(
        `Installed ${installation.skillCount} ${installation.skillCount === 1 ? 'skill' : 'skills'} using ${method}.`,
      )
      return
    }

    const installedAgents = userScopeHooksAccepted
      ? installConfiguredHooks(root, targets, homeDir, copilotHome)
      : []
    const skippedHooks = userScopeHooksAccepted
      ? ''
      : ' Hooks were skipped because home-directory access was declined.'
    prompts.complete(
      `Installed ${installation.skillCount} ${installation.skillCount === 1 ? 'skill' : 'skills'} using hooks. Installed hook agents: ${installedAgents.length > 0 ? installedAgents.join(', ') : 'none'}.${skippedHooks}`,
    )
    return
  }
}
