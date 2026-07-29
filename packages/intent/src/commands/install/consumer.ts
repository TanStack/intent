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
import type { IntentConsumerConfig } from './config.js'
import type {
  InstallMethod,
  InstallTarget,
  IntentDeliveryConfig,
} from './delivery.js'
import type { SkillSelection } from './plan.js'
import type { HookAgent, HookInstallScope } from '../../hooks/types.js'
import type { ReadFs } from '../../shared/utils.js'
import type { IntentPackage } from '../../shared/types.js'

export type InstallConfirmation = 'install' | 'back' | null

export interface InstallerPrompter {
  complete: (message: string) => void
  selectMethod: () => Promise<InstallMethod | null>
  selectTargets: (
    method: InstallMethod,
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
  discovered: ReadonlyArray<IntentPackage>
  dryRun?: boolean
  prompts: InstallerPrompter
  readFs?: ReadFs
  root: string
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

async function confirmUserScopeHooks(
  targets: ReadonlyArray<InstallTarget>,
  prompts: InstallerPrompter,
): Promise<boolean | null> {
  if (!targets.includes('github')) return false
  return prompts.confirmUserScopeHooks()
}

function installHookAgents(
  root: string,
  agents: string,
  scope: HookInstallScope,
): Array<HookAgent> {
  return runInstallHooks({ agents, root, scope })
    .filter((result) => result.status !== 'skipped')
    .map((result) => result.agent)
}

function installConfiguredHooks(
  root: string,
  targets: ReadonlyArray<InstallTarget>,
  userScopeHooksAccepted: boolean,
): Array<HookAgent> {
  const hookAgents = targets.map(hookAgentForTarget)
  const projectAgents = hookAgents.filter((agent) => agent !== 'copilot')
  const installedAgents =
    projectAgents.length > 0
      ? installHookAgents(root, projectAgents.join(','), 'project')
      : []
  if (userScopeHooksAccepted) {
    installedAgents.push(...installHookAgents(root, 'copilot', 'user'))
  }
  return installedAgents
}

export async function runConsumerInstall({
  discovered,
  dryRun = false,
  prompts,
  readFs = nodeReadFs,
  root,
}: RunConsumerInstallOptions): Promise<void> {
  const packageJsonPath = join(root, 'package.json')
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  const intentDevDependency = hasIntentDevDependency(packageJson)
  const existingConfig = readIntentConsumerConfig(packageJson)
  const existingLock = readIntentLockfile(join(root, 'intent.lock'))
  const delivery = dryRun ? null : readIntentDeliveryConfig(root)
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
      if (delivery.method === 'symlink') {
        prompts.complete('Project is up to date.')
        return
      }
      const userScopeHooksAccepted = await confirmUserScopeHooks(
        delivery.targets,
        prompts,
      )
      if (userScopeHooksAccepted === null) return
      const installedAgents = installConfiguredHooks(
        root,
        delivery.targets,
        userScopeHooksAccepted,
      )
      const repairedHooks =
        installedAgents.length > 0 ? ' Repaired configured hooks.' : ''
      const skippedCopilot =
        delivery.targets.includes('github') && !userScopeHooksAccepted
          ? ' Copilot was skipped because home-directory access was declined.'
          : ''
      prompts.complete(
        `Project is up to date.${repairedHooks}${skippedCopilot}`,
      )
      return
    }
    console.log(
      `Install changes: ${newDependencies} new ${newDependencies === 1 ? 'dependency' : 'dependencies'}, ${newSkills} new ${newSkills === 1 ? 'skill' : 'skills'}, ${changed} changed, ${summary.removed} removed.`,
    )
  }
  for (;;) {
    const method = delivery ? delivery.method : await prompts.selectMethod()
    if (!method) return
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
    const hasCommittedTrust =
      existingLock.status === 'found' &&
      (existingConfig.skills.length > 0 || existingConfig.exclude.length > 0)
    const reusingCommittedTrust = !delivery && hasCommittedTrust
    const selection = reusingCommittedTrust
      ? null
      : await prompts.selectSkills(discovered)
    if (!reusingCommittedTrust && !selection) return
    const plan = selection
      ? buildSkillSelectionPlan(discovered, selection)
      : null
    const config = plan
      ? { skills: plan.skills, exclude: plan.exclude }
      : existingConfig
    const deliveryConfig = { method, targets }
    const installation = {
      config,
      delivery: deliveryConfig,
      skillCount: (plan?.packages ?? discovered).reduce(
        (count, pkg) =>
          count +
          pkg.skills.filter(
            (skill) => !('status' in skill) || skill.status === 'enabled',
          ).length,
        0,
      ),
    }
    const confirmation = await prompts.confirmInstall(installation)
    if (confirmation === null) return
    if (confirmation === 'back') continue

    const updatedConsumerConfig = updateIntentConsumerConfigText(
      packageJson,
      installation.config,
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
      prompts.complete('Dry run complete.')
      return
    }

    const userScopeHooksAccepted =
      method === 'hooks' ? await confirmUserScopeHooks(targets, prompts) : false
    if (userScopeHooksAccepted === null) return

    if (updatedPackageJson !== packageJson) {
      writeTextFileAtomic(packageJsonPath, updatedPackageJson)
    }
    if (!hasCommittedTrust) {
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

    const installedAgents = installConfiguredHooks(
      root,
      targets,
      userScopeHooksAccepted,
    )
    const skippedCopilot =
      targets.includes('github') && !userScopeHooksAccepted
        ? ' Copilot was skipped because home-directory access was declined.'
        : ''
    prompts.complete(
      `Installed ${installation.skillCount} ${installation.skillCount === 1 ? 'skill' : 'skills'} using hooks. Installed hook agents: ${installedAgents.length > 0 ? installedAgents.join(', ') : 'none'}.${skippedCopilot}`,
    )
    return
  }
}
