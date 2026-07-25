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
import { runSyncCommand } from '../sync/command.js'
import { reconcileManagedLinks } from '../sync/links.js'
import { buildSyncLinkPlan } from '../sync/plan.js'
import { wireIntentSyncPrepare } from '../sync/prepare.js'
import { readInstallStateForLinks } from '../sync/state.js'
import { toProjectRelativePath } from '../sync/targets.js'
import {
  INSTALL_TARGETS,
  detectInstallTargets,
  hasIntentDevDependency,
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from './config.js'
import {
  buildInstallDeltaInventory,
  buildSkillSelectionPlan,
  summarizeInstallDeltaInventory,
} from './plan.js'
import type {
  InstallMethod,
  InstallTarget,
  IntentConsumerConfig,
  IntentInstallPreferences,
} from './config.js'
import type { SkillSelection } from './plan.js'
import type { HookAgent } from '../../hooks/types.js'
import type { IntentPackage } from '../../shared/types.js'

interface ConsumerInstallConfig extends IntentConsumerConfig {
  install: IntentInstallPreferences
}

export type InstallConfirmation = 'install' | 'back' | null

export interface InstallerPrompter {
  advisory: (message: string) => void
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
    config: ConsumerInstallConfig
    skillCount: number
  }) => Promise<InstallConfirmation>
}

export interface RunConsumerInstallOptions {
  discovered: ReadonlyArray<IntentPackage>
  dryRun?: boolean
  prompts: InstallerPrompter
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

export async function runConsumerInstall({
  discovered,
  dryRun = false,
  prompts,
  root,
}: RunConsumerInstallOptions): Promise<void> {
  const packageJsonPath = join(root, 'package.json')
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  const intentDevDependency = hasIntentDevDependency(packageJson)
  const existingConfig = readIntentConsumerConfig(packageJson)
  const configured = !dryRun && existingConfig.install !== undefined
  if (configured) {
    const inventory = buildInstallDeltaInventory(
      discovered,
      buildCurrentLockfileSources(discovered),
      readIntentLockfile(join(root, 'intent.lock')),
      existingConfig,
    )
    const summary = summarizeInstallDeltaInventory(inventory)
    const newDependencies = countSkills(summary.newDependencies)
    const newSkills = countSkills(summary.newSkills)
    const changed = countSkills(summary.changed)
    if (
      newDependencies === 0 &&
      newSkills === 0 &&
      changed === 0 &&
      summary.removed === 0
    ) {
      prompts.complete('Project is up to date.')
      return
    }
    console.log(
      `Install changes: ${newDependencies} new ${newDependencies === 1 ? 'dependency' : 'dependencies'}, ${newSkills} new ${newSkills === 1 ? 'skill' : 'skills'}, ${changed} changed, ${summary.removed} removed.`,
    )
  }
  for (;;) {
    const method = configured
      ? existingConfig.install!.method
      : await prompts.selectMethod()
    if (!method) return
    const targets = configured
      ? existingConfig.install!.targets
      : await prompts.selectTargets(method, detectInstallTargets(root))
    if (!targets || targets.length === 0) return
    if (!configured && method === 'symlink') {
      const symlinkAccepted = await prompts.confirmSymlink()
      if (!symlinkAccepted) return
    }
    if (discovered.every((pkg) => pkg.skills.length === 0)) {
      prompts.complete('No intent-enabled skills found.')
      return
    }
    const selection = await prompts.selectSkills(discovered)
    if (!selection) return
    const plan = buildSkillSelectionPlan(discovered, selection)
    const installation = {
      config: {
        skills: plan.skills,
        exclude: plan.exclude,
        install: { method, targets },
      } satisfies ConsumerInstallConfig,
      skillCount: plan.packages.reduce(
        (count, pkg) =>
          count +
          pkg.skills.filter((skill) => skill.status === 'enabled').length,
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
      sources: buildCurrentLockfileSources(policy.packages),
    }
    if (method === 'symlink') {
      const linkPlan = buildSyncLinkPlan({
        config: installation.config,
        currentSources: lockfile.sources,
        discovered,
        lock: { status: 'found', lockfile },
        packages: policy.packages,
        root,
      })
      const preflight = reconcileManagedLinks({
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

    let userScopeHooksAccepted = false
    if (method === 'hooks' && targets.includes('github')) {
      const accepted = await prompts.confirmUserScopeHooks()
      if (accepted === null) return
      userScopeHooksAccepted = accepted
    }

    writeTextFileAtomic(packageJsonPath, updatedPackageJson)
    writeIntentLockfile(join(root, 'intent.lock'), lockfile)
    if (!intentDevDependency) {
      prompts.advisory(
        'Skills will not re-sync automatically because the prepare script was not wired. intent.lock records the accepted skill baseline, but nothing will check it automatically. Add @tanstack/intent as a devDependency to enable both.',
      )
    }
    if (method === 'symlink') {
      await runSyncCommand({ cwd: root }, { interactive: false })
      prompts.complete(
        `Installed ${installation.skillCount} ${installation.skillCount === 1 ? 'skill' : 'skills'} using ${method}.`,
      )
      return
    }

    const hookAgents = targets.map(hookAgentForTarget)
    const projectAgents = hookAgents.filter((agent) => agent !== 'copilot')
    const installedAgents =
      projectAgents.length > 0
        ? runInstallHooks({
            agents: projectAgents.join(','),
            root,
            scope: 'project',
          })
            .filter((result) => result.status !== 'skipped')
            .map((result) => result.agent)
        : []
    if (userScopeHooksAccepted) {
      installedAgents.push(
        ...runInstallHooks({ agents: 'copilot', root, scope: 'user' })
          .filter((result) => result.status !== 'skipped')
          .map((result) => result.agent),
      )
    }
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
