import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { readIntentLockfile } from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { scanForConfiguredIntents } from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { readIntentConsumerConfig } from '../install/config.js'
import { updateIntentGitignore } from './gitignore.js'
import { reconcileManagedLinks } from './links.js'
import { buildSyncLinkPlan } from './plan.js'
import {
  INSTALL_STATE_PATH,
  readInstallStateForLinks,
  writeInstallState,
} from './state.js'
import { toProjectRelativePath } from './targets.js'

export interface SyncCommandOptions {
  cwd?: string
  dryRun?: boolean
  json?: boolean
}

interface SyncPackageSummary {
  name: string
  skillCount: number
}

interface SyncCommandResult {
  created: Array<string>
  repaired: Array<string>
  removed: Array<string>
  unchanged: Array<string>
  conflicts: Array<string>
  newDependencies: Array<SyncPackageSummary>
  newSkills: Array<SyncPackageSummary>
  changed: Array<SyncPackageSummary>
}

function formatPackageSummaries(entries: Array<SyncPackageSummary>): string {
  const width = Math.max(...entries.map((entry) => entry.name.length))
  return entries
    .map(
      (entry) =>
        `${entry.name.padEnd(width)}  ${entry.skillCount} ${entry.skillCount === 1 ? 'skill' : 'skills'}`,
    )
    .join('\n')
}

function printReminder(
  title: string,
  entries: Array<SyncPackageSummary>,
  action: string,
): void {
  if (entries.length === 0) return
  console.log(`${title}:\n\n${formatPackageSummaries(entries)}\n\n${action}`)
}

function writeGitignore(root: string, paths: Array<string>): boolean {
  const path = join(root, '.gitignore')
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null
  const after = updateIntentGitignore(before, paths)
  if (before === after) return false
  writeFileSync(path, after, 'utf8')
  return true
}

function output(result: SyncCommandResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result))
    return
  }
  console.log(
    `Intent sync: ${result.created.length} created, ${result.repaired.length} repaired, ${result.removed.length} removed.`,
  )
  printReminder(
    'New dependencies with skills found',
    result.newDependencies,
    'Run `intent install` to review and install them, or add them to `intent.exclude`.',
  )
  printReminder(
    'New skills found in enabled dependencies',
    result.newSkills,
    'Run `intent install` to review and install them.',
  )
  printReminder(
    'Changed skill content',
    result.changed,
    'Run `intent install` to review and accept the new baseline.',
  )
  if (result.conflicts.length > 0)
    console.log(`Conflicts: ${result.conflicts.join(', ')}.`)
}

export function runSyncCommand(options: SyncCommandOptions): void {
  const context = resolveProjectContext({ cwd: options.cwd ?? process.cwd() })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) {
    fail(
      'Intent sync requires intent.install configuration and intent.lock. Run `intent install` first.',
    )
  }
  const config = readIntentConsumerConfig(readFileSync(packageJsonPath, 'utf8'))
  const lock = readIntentLockfile(join(root, 'intent.lock'))
  if (!config.install || lock.status !== 'found') {
    fail(
      'Intent sync requires intent.install configuration and intent.lock. Run `intent install` first.',
    )
  }
  if (config.install.method !== 'symlink') {
    fail(
      `Intent sync adapter for method "${config.install.method}" is not implemented yet.`,
    )
  }

  const { discovered, policy } = scanForConfiguredIntents({
    root,
    config: parseSkillSources(config.skills),
    exclude: config.exclude,
  })
  const current = buildCurrentLockfileSources(policy.packages)
  const { expected, inventory } = buildSyncLinkPlan({
    config,
    currentSources: current,
    discovered,
    lock,
    packages: policy.packages,
    root,
  })
  const links = reconcileManagedLinks({
    dryRun: options.dryRun === true,
    expected,
    stateResult: readInstallStateForLinks(root),
  })
  const summaries = {
    newDependencies: inventory.packages
      .map((pkg) => ({
        name: pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name,
        skillCount: pkg.skills.filter((skill) => skill.policy === 'pending')
          .length,
      }))
      .filter((entry) => entry.skillCount > 0),
    newSkills: inventory.packages
      .map((pkg) => ({
        name: pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name,
        skillCount: pkg.skills.filter(
          (skill) => skill.policy === 'enabled' && skill.lock === 'new',
        ).length,
      }))
      .filter((entry) => entry.skillCount > 0),
    changed: inventory.packages
      .map((pkg) => ({
        name: pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name,
        skillCount: pkg.skills.filter(
          (skill) => skill.policy === 'enabled' && skill.lock === 'changed',
        ).length,
      }))
      .filter((entry) => entry.skillCount > 0),
  }
  const result = {
    created: links.created.map((path) => toProjectRelativePath(root, path)),
    repaired: links.repaired.map((path) => toProjectRelativePath(root, path)),
    removed: links.removed.map((path) => toProjectRelativePath(root, path)),
    unchanged: links.unchanged.map((path) => toProjectRelativePath(root, path)),
    conflicts: links.conflicts.map((path) => toProjectRelativePath(root, path)),
    ...summaries,
  }
  if (!options.dryRun) {
    const stateEntries = links.entries.map((entry) => ({
      ...entry,
      path: toProjectRelativePath(root, entry.path),
    }))
    writeInstallState(root, { version: 1, entries: stateEntries })
    writeGitignore(root, [
      ...stateEntries.map((entry) => entry.path),
      INSTALL_STATE_PATH,
    ])
  }
  output(result, options.json === true)
  if (links.conflicts.length > 0)
    fail('Intent sync found managed link conflicts.')
}
