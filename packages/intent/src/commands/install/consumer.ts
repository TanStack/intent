import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileExcludePatterns } from '../../core/excludes.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../../core/lockfile/lockfile.js'
import { applySourcePolicy } from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import { runSyncCommand } from '../sync/command.js'
import { reconcileManagedLinks } from '../sync/links.js'
import { buildSyncLinkPlan } from '../sync/plan.js'
import { readInstallStateForLinks } from '../sync/state.js'
import { toProjectRelativePath } from '../sync/targets.js'
import {
  INSTALL_TARGETS,
  hasIntentDevDependency,
  updateIntentConsumerConfigText,
} from './config.js'
import { buildSkillSelectionPlan } from './plan.js'
import type {
  InstallMethod,
  InstallTarget,
  IntentConsumerConfig,
  IntentInstallPreferences,
} from './config.js'
import type { SkillSelection } from './plan.js'
import type { IntentPackage } from '../../shared/types.js'

interface ConsumerInstallConfig extends IntentConsumerConfig {
  install: IntentInstallPreferences
}

export type InstallConfirmation = 'install' | 'back' | null

export interface InstallerPrompter {
  complete: (message: string) => void
  selectTargets: () => Promise<Array<InstallTarget> | null>
  selectMethod: () => Promise<InstallMethod | null>
  confirmSymlink: () => Promise<boolean | null>
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

export async function runConsumerInstall({
  discovered,
  dryRun = false,
  prompts,
  root,
}: RunConsumerInstallOptions): Promise<void> {
  const packageJsonPath = join(root, 'package.json')
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  if (!hasIntentDevDependency(packageJson)) {
    throw new Error(
      '@tanstack/intent must be installed as a project devDependency before running `intent install`.',
    )
  }
  for (;;) {
    const targets = await prompts.selectTargets()
    if (!targets || targets.length === 0) return
    const method = await prompts.selectMethod()
    if (!method) return
    if (method !== 'symlink') {
      throw new Error(`Install method "${method}" is not implemented yet.`)
    }
    const symlinkAccepted = await prompts.confirmSymlink()
    if (!symlinkAccepted) return
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

    const updatedPackageJson = updateIntentConsumerConfigText(
      packageJson,
      installation.config,
    )
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

    writeTextFileAtomic(packageJsonPath, updatedPackageJson)
    writeIntentLockfile(join(root, 'intent.lock'), lockfile)
    runSyncCommand({ cwd: root })
    prompts.complete(
      `Installed ${installation.skillCount} ${installation.skillCount === 1 ? 'skill' : 'skills'} using ${method}.`,
    )
    return
  }
}
