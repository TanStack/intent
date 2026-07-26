import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { compileExcludePatterns } from '../../core/excludes.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import {
  readIntentLockfile,
  writeIntentLockfile,
} from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import {
  applySourcePolicy,
  compileSkillSourcePolicy,
  scanForConfiguredIntents,
} from '../../core/source-policy.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import {
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from '../install/config.js'
import { buildSkillSelectionPlan } from '../install/plan.js'
import { updateIntentGitignore } from './gitignore.js'
import { reconcileManagedLinks } from './links.js'
import { buildSyncLinkPlan } from './plan.js'
import {
  INSTALL_STATE_PATH,
  readInstallStateForLinks,
  writeInstallState,
} from './state.js'
import { toProjectRelativePath } from './targets.js'
import type { SkillSelection } from '../install/plan.js'
import type { LinkReconciliation } from './links.js'
import type { IntentPackage } from '../../shared/types.js'

export interface SyncCommandOptions {
  cwd?: string
  dryRun?: boolean
  json?: boolean
}

export type NewDependencyDecision = 'review' | 'exclude' | 'later'

export interface SyncReviewPrompter {
  complete: (message: string) => void
  reviewNewDependencies: (
    entries: ReadonlyArray<SyncPackageSummary>,
  ) => Promise<NewDependencyDecision | null>
  selectSkills: (
    packages: ReadonlyArray<IntentPackage>,
  ) => Promise<SkillSelection | null>
}

export type SyncReviewMode = 'interactive' | 'reminder' | 'fail'

export interface SyncCommandRuntime {
  review?: SyncReviewMode
  prompts?: SyncReviewPrompter
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

function printReminder(
  title: string,
  entries: Array<SyncPackageSummary>,
  action: string,
): void {
  if (entries.length === 0) return
  const width = Math.max(...entries.map((entry) => entry.name.length))
  const packages = entries
    .map(
      (entry) =>
        `${entry.name.padEnd(width)}  ${entry.skillCount} ${entry.skillCount === 1 ? 'skill' : 'skills'}`,
    )
    .join('\n')
  console.log(`${title}:\n\n${packages}\n\n${action}`)
}

function writeGitignore(root: string, paths: Array<string>): boolean {
  const path = join(root, '.gitignore')
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null
  const after = updateIntentGitignore(before, paths)
  if (before === after) return false
  writeFileSync(path, after, 'utf8')
  return true
}

function writeManagedLinkState(root: string, links: LinkReconciliation): void {
  const entries = links.entries.map((entry) => ({
    ...entry,
    path: toProjectRelativePath(root, entry.path),
  }))
  writeInstallState(root, { version: 1, entries })
  writeGitignore(root, [
    ...entries.map((entry) => entry.path),
    INSTALL_STATE_PATH,
  ])
}

function output(
  result: SyncCommandResult,
  json: boolean,
  interactiveReview: boolean,
): void {
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
    interactiveReview
      ? 'Choose how to handle them below.'
      : 'Run `intent install` to review and install them, or add them to `intent.exclude`.',
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sourceKey(source: Pick<IntentPackage, 'kind' | 'name'>): string {
  return `${source.kind}\0${source.name}`
}

function sourceName(source: Pick<IntentPackage, 'kind' | 'name'>): string {
  return source.kind === 'workspace' ? `workspace:${source.name}` : source.name
}

function shouldReviewInteractively(
  options: SyncCommandOptions,
  runtime: SyncCommandRuntime,
): boolean {
  if (
    options.dryRun === true ||
    options.json === true ||
    process.env.npm_lifecycle_event === 'prepare'
  ) {
    return false
  }
  if (runtime.review !== undefined) return runtime.review === 'interactive'
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}

async function reviewNewDependencies({
  config,
  discovered,
  lock,
  packages,
  prompts,
  root,
}: {
  config: ReturnType<typeof readIntentConsumerConfig>
  discovered: Array<IntentPackage>
  lock: Extract<ReturnType<typeof readIntentLockfile>, { status: 'found' }>
  packages: Array<IntentPackage>
  prompts: SyncReviewPrompter
  root: string
}): Promise<void> {
  const decision = await prompts.reviewNewDependencies(
    packages.map((pkg) => ({
      name: sourceName(pkg),
      skillCount: pkg.skills.length,
    })),
  )
  if (!decision || decision === 'later') {
    prompts.complete('New dependencies remain pending.')
    return
  }
  const packageJsonPath = join(root, 'package.json')
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  if (decision === 'exclude') {
    const sourcePolicy = compileSkillSourcePolicy(
      parseSkillSources(config.skills),
    )
    const updatedConfig = {
      ...config,
      exclude: [
        ...new Set([
          ...config.exclude,
          ...packages.flatMap((pkg) =>
            sourcePolicy.permits(pkg.name, pkg.kind)
              ? pkg.skills.map((skill) => `${pkg.name}#${skill.name}`)
              : [pkg.name],
          ),
        ]),
      ].sort(compareStrings),
    }
    writeTextFileAtomic(
      packageJsonPath,
      updateIntentConsumerConfigText(packageJson, updatedConfig),
    )
    prompts.complete('Excluded new skill dependencies.')
    return
  }

  const selection = await prompts.selectSkills(packages)
  if (!selection) {
    prompts.complete('New dependencies remain pending.')
    return
  }
  const selectionPlan = buildSkillSelectionPlan(packages, selection)
  const configuredSources = parseSkillSources(config.skills)
  const configuredPolicy = compileSkillSourcePolicy(configuredSources)
  const addedSkills = new Set(selectionPlan.skills)
  for (const pkg of selectionPlan.packages) {
    const packageCovered =
      configuredSources.mode === 'absent' ||
      configuredSources.mode === 'allow-all' ||
      configuredPolicy.matchers.some(
        (matcher) =>
          matcher.matchesSkill === undefined &&
          matcher.matchesPackage(pkg.name, pkg.kind),
      )
    if (packageCovered) {
      addedSkills.delete(sourceName(pkg))
      for (const skill of pkg.skills) addedSkills.delete(skill.id)
      continue
    }
    const hasSkillEntries = configuredPolicy.matchers.some(
      (matcher) =>
        matcher.matchesSkill !== undefined &&
        matcher.matchesPackage(pkg.name, pkg.kind),
    )
    if (hasSkillEntries) {
      addedSkills.delete(sourceName(pkg))
      for (const skill of pkg.skills) {
        if (skill.status === 'enabled') addedSkills.add(skill.id)
      }
    }
  }
  const updatedConfig = {
    ...config,
    skills: [...new Set([...config.skills, ...addedSkills])].sort(
      compareStrings,
    ),
    exclude: [...new Set([...config.exclude, ...selectionPlan.exclude])].sort(
      compareStrings,
    ),
  }
  const policy = applySourcePolicy(
    { packages: discovered },
    {
      config: parseSkillSources(updatedConfig.skills),
      excludeMatchers: compileExcludePatterns(updatedConfig.exclude),
    },
  )
  const reviewedKeys = new Set(packages.map(sourceKey))
  const currentSources = buildCurrentLockfileSources(policy.packages)
  const prospectiveLock = {
    lockfileVersion: 1 as const,
    sources: [
      ...lock.lockfile.sources.filter(
        (source) => !reviewedKeys.has(`${source.kind}\0${source.id}`),
      ),
      ...currentSources.filter((source) =>
        reviewedKeys.has(`${source.kind}\0${source.id}`),
      ),
    ],
  }
  const expected = buildSyncLinkPlan({
    config: updatedConfig,
    currentSources,
    discovered,
    lock: { status: 'found', lockfile: prospectiveLock },
    packages: policy.packages,
    root,
  }).expected
  const stateResult = readInstallStateForLinks(root)
  const preflight = reconcileManagedLinks({
    dryRun: true,
    expected,
    stateResult,
  })
  if (preflight.conflicts.length > 0) {
    fail(
      `Intent sync found managed link conflicts: ${preflight.conflicts
        .map((path) => toProjectRelativePath(root, path))
        .join(', ')}.`,
    )
  }
  writeTextFileAtomic(
    packageJsonPath,
    updateIntentConsumerConfigText(packageJson, updatedConfig),
  )
  writeIntentLockfile(join(root, 'intent.lock'), prospectiveLock)
  const links = reconcileManagedLinks({
    dryRun: false,
    expected,
    stateResult,
  })
  writeManagedLinkState(root, links)
  prompts.complete(
    'Installed selected skills using the existing delivery settings.',
  )
}

export async function runSyncCommand(
  options: SyncCommandOptions,
  runtime: SyncCommandRuntime = {},
): Promise<void> {
  const context = resolveProjectContext({ cwd: options.cwd ?? process.cwd() })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) {
    fail(
      'Intent sync requires intent.install configuration and intent.lock. Run `intent install` first.',
    )
  }
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  const config = readIntentConsumerConfig(packageJson)
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
  const { expected, inventory } = buildSyncLinkPlan({
    config,
    currentSources: buildCurrentLockfileSources(policy.packages),
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
        name: sourceName(pkg),
        skillCount: pkg.skills.filter((skill) => skill.policy === 'pending')
          .length,
      }))
      .filter((entry) => entry.skillCount > 0),
    newSkills: inventory.packages
      .map((pkg) => ({
        name: sourceName(pkg),
        skillCount: pkg.skills.filter(
          (skill) => skill.policy === 'enabled' && skill.lock === 'new',
        ).length,
      }))
      .filter((entry) => entry.skillCount > 0),
    changed: inventory.packages
      .map((pkg) => ({
        name: sourceName(pkg),
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
    writeManagedLinkState(root, links)
  }
  const interactiveReview =
    summaries.newDependencies.length > 0 &&
    shouldReviewInteractively(options, runtime)
  output(result, options.json === true, interactiveReview)
  if (links.conflicts.length > 0)
    fail('Intent sync found managed link conflicts.')
  if (
    runtime.review === 'fail' &&
    (summaries.newDependencies.length > 0 ||
      summaries.newSkills.length > 0 ||
      summaries.changed.length > 0)
  ) {
    fail('Intent sync requires review before automation can continue.')
  }
  if (interactiveReview) {
    const pendingSkills = new Map(
      inventory.packages.map((pkg) => [
        `${pkg.kind}\0${pkg.name}`,
        new Set(
          pkg.skills
            .filter((skill) => skill.policy === 'pending')
            .map((skill) => skill.id.slice(skill.id.indexOf('#') + 1)),
        ),
      ]),
    )
    const packages = discovered.flatMap((pkg) => {
      const skills = pendingSkills.get(sourceKey(pkg))
      if (!skills || skills.size === 0) return []
      return [
        {
          ...pkg,
          skills: pkg.skills.filter((skill) => skills.has(skill.name)),
        },
      ]
    })
    const prompts =
      runtime.prompts ??
      (await import('./prompts.js')).createClackSyncReviewPrompter()
    await reviewNewDependencies({
      config,
      discovered,
      lock,
      packages,
      prompts,
      root,
    })
  }
}
