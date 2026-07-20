import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { readIntentLockfile } from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { scanForConfiguredIntents } from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { readIntentConsumerConfig } from '../install/config.js'
import { buildInstallDeltaInventory } from '../install/plan.js'
import { updateIntentGitignore } from './gitignore.js'
import { reconcileManagedLinks } from './links.js'
import {
  INSTALL_STATE_PATH,
  readInstallState,
  writeInstallState,
} from './state.js'
import {
  createSyncAliases,
  resolveSyncTargetDirectories,
  toProjectRelativePath,
} from './targets.js'
import type { IntentPackage } from '../../shared/types.js'

export interface SyncCommandOptions {
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
  pending: Array<SyncPackageSummary>
  changed: Array<SyncPackageSummary>
}

function findSkill(pkg: IntentPackage, name: string) {
  return pkg.skills.find((skill) => skill.name === name)
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
  if (result.pending.length > 0)
    console.log(
      `Pending: ${result.pending.map((entry) => `${entry.name} (${entry.skillCount})`).join(', ')}.`,
    )
  if (result.changed.length > 0)
    console.log(
      `Changed: ${result.changed.map((entry) => `${entry.name} (${entry.skillCount})`).join(', ')}.`,
    )
  if (result.conflicts.length > 0)
    console.log(`Conflicts: ${result.conflicts.join(', ')}.`)
}

export function runSyncCommand(options: SyncCommandOptions): void {
  const context = resolveProjectContext({ cwd: process.cwd() })
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
  const inventory = buildInstallDeltaInventory(
    discovered,
    current,
    lock,
    config,
  )
  const aliases = new Map(
    createSyncAliases(
      policy.packages.flatMap((pkg) =>
        pkg.skills.map((skill) => ({
          kind: pkg.kind,
          id: pkg.name,
          skill: skill.name,
        })),
      ),
    ).map((entry) => [
      `${entry.kind}\0${entry.id}\0${entry.skill}`,
      entry.alias,
    ]),
  )
  const sources = new Map(
    discovered.map((pkg) => [`${pkg.kind}\0${pkg.name}`, pkg]),
  )
  const accepted = inventory.packages.flatMap((pkg) => {
    const source = sources.get(`${pkg.kind}\0${pkg.name}`)
    if (!source) return []
    return pkg.skills.flatMap((skill) => {
      if (skill.policy !== 'enabled' || skill.lock !== 'accepted') return []
      const sourceSkill = findSkill(
        source,
        skill.id.slice(skill.id.indexOf('#') + 1),
      )
      return sourceSkill ? [{ pkg, skill: sourceSkill, source }] : []
    })
  })
  const targetDirectories = resolveSyncTargetDirectories(
    root,
    config.install.targets,
  )
  const expected = accepted.flatMap(({ pkg, skill, source }) => {
    const alias = aliases.get(`${pkg.kind}\0${pkg.name}\0${skill.name}`)!
    return targetDirectories.map((target) => {
      const path = join(target.path, alias)
      return {
        path,
        targetDirectory: toProjectRelativePath(root, target.path),
        alias,
        source: { kind: pkg.kind, id: pkg.name },
        skillPath: `skills/${skill.name}`,
        sourceDirectory: dirname(skill.path),
        packageRoot: source.packageRoot,
      }
    })
  })
  const persistedState = readInstallState(root)
  const stateForLinks =
    persistedState.status === 'found'
      ? {
          status: 'found' as const,
          state: {
            version: 1 as const,
            entries: persistedState.state.entries.map((entry) => ({
              ...entry,
              path: join(root, ...entry.path.split('/')),
            })),
          },
        }
      : persistedState
  const links = reconcileManagedLinks({
    dryRun: options.dryRun === true,
    expected,
    stateResult: stateForLinks,
  })
  const pending = inventory.packages
    .map((pkg) => ({
      name: pkg.name,
      skillCount: pkg.skills.filter(
        (skill) =>
          skill.policy === 'pending' ||
          (skill.policy === 'enabled' && skill.lock === 'new'),
      ).length,
    }))
    .filter((entry) => entry.skillCount > 0)
  const changed = inventory.packages
    .map((pkg) => ({
      name: pkg.name,
      skillCount: pkg.skills.filter(
        (skill) => skill.policy === 'enabled' && skill.lock === 'changed',
      ).length,
    }))
    .filter((entry) => entry.skillCount > 0)
  const result = {
    created: links.created.map((path) => toProjectRelativePath(root, path)),
    repaired: links.repaired.map((path) => toProjectRelativePath(root, path)),
    removed: links.removed.map((path) => toProjectRelativePath(root, path)),
    unchanged: links.unchanged.map((path) => toProjectRelativePath(root, path)),
    conflicts: links.conflicts.map((path) => toProjectRelativePath(root, path)),
    pending,
    changed,
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
