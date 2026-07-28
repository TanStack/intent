import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { compileExcludePatterns } from '../../core/excludes.js'
import { createIntentFsCache } from '../../discovery/fs-cache.js'
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
import { hasNonNativeLinkSource, reconcileManagedLinks } from './links.js'
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
import type { ReadFs } from '../../shared/utils.js'

type SyncSkillSelection = Extract<SkillSelection, { mode: 'individual' }>

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
  ) => Promise<SyncSkillSelection | null>
}

type SyncReviewMode = 'interactive' | 'reminder' | 'fail'

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

function buildSyncCommandResult(
  root: string,
  links: LinkReconciliation,
  summaries: Pick<
    SyncCommandResult,
    'newDependencies' | 'newSkills' | 'changed'
  >,
): SyncCommandResult {
  return {
    created: links.created.map((path) => toProjectRelativePath(root, path)),
    repaired: links.repaired.map((path) => toProjectRelativePath(root, path)),
    removed: links.removed.map((path) => toProjectRelativePath(root, path)),
    unchanged: links.unchanged.map((path) => toProjectRelativePath(root, path)),
    conflicts: links.conflicts.map((path) => toProjectRelativePath(root, path)),
    ...summaries,
  }
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
    'Pending skills by source',
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
  reviewedPackages,
  prompts,
  readFs,
  root,
}: {
  config: ReturnType<typeof readIntentConsumerConfig>
  discovered: Array<IntentPackage>
  lock: Extract<ReturnType<typeof readIntentLockfile>, { status: 'found' }>
  packages: Array<IntentPackage>
  reviewedPackages: Array<IntentPackage>
  prompts: SyncReviewPrompter
  readFs: ReadFs
  root: string
}): Promise<void> {
  const decision = await prompts.reviewNewDependencies(
    packages.map((pkg) => ({
      name: sourceName(pkg),
      skillCount: pkg.skills.length,
    })),
  )
  if (!decision || decision === 'later') {
    prompts.complete('Pending skills remain pending review.')
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
    prompts.complete('Excluded pending skills.')
    return
  }

  const selection = await prompts.selectSkills(packages)
  if (!selection) {
    prompts.complete('Pending skills remain pending review.')
    return
  }
  const pendingSelectionPlan = buildSkillSelectionPlan(packages, selection)
  const pendingSkillIds = new Set(
    packages.flatMap((pkg) =>
      pkg.skills.map((skill) => `${sourceName(pkg)}#${skill.name}`),
    ),
  )
  const selectionPlan = buildSkillSelectionPlan(reviewedPackages, {
    ...selection,
    enabled: [
      ...new Set([
        ...selection.enabled,
        ...reviewedPackages.flatMap((pkg) =>
          pkg.skills
            .map((skill) => `${sourceName(pkg)}#${skill.name}`)
            .filter((id) => !pendingSkillIds.has(id)),
        ),
      ]),
    ],
  })
  const packageExcludes = new Set(selectionPlan.exclude)
  const narrowedExcludes = packages.flatMap((pkg) =>
    pendingSelectionPlan.exclude.includes(pkg.name) &&
    !packageExcludes.has(pkg.name)
      ? pkg.skills.map((skill) => `${pkg.name}#${skill.name}`)
      : [],
  )
  const configuredSources = parseSkillSources(config.skills)
  const configuredPolicy = compileSkillSourcePolicy(configuredSources)
  const addedSkills = new Set(selectionPlan.skills)
  for (const pkg of selectionPlan.packages) {
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
    exclude: [
      ...new Set([
        ...config.exclude,
        ...selectionPlan.exclude,
        ...narrowedExcludes,
      ]),
    ].sort(compareStrings),
  }
  const policy = applySourcePolicy(
    { packages: discovered },
    {
      config: parseSkillSources(updatedConfig.skills),
      excludeMatchers: compileExcludePatterns(updatedConfig.exclude),
    },
  )
  const currentSources = buildCurrentLockfileSources(policy.packages, readFs)
  const selectedPendingIds = new Set(selection.enabled)
  const selectedPathsBySource = new Map(
    packages.flatMap((pkg) => {
      const paths = pkg.skills
        .filter((skill) =>
          selectedPendingIds.has(`${sourceName(pkg)}#${skill.name}`),
        )
        .map((skill) => `skills/${skill.name}`)
      return paths.length > 0 ? [[sourceKey(pkg), new Set(paths)] as const] : []
    }),
  )
  const selectedCurrentSources = new Map(
    currentSources.flatMap((source) => {
      const key = `${source.kind}\0${source.id}`
      const selectedPaths = selectedPathsBySource.get(key)
      if (!selectedPaths) return []
      return [
        [
          key,
          {
            ...source,
            skills: source.skills.filter((skill) =>
              selectedPaths.has(skill.path),
            ),
          },
        ] as const,
      ]
    }),
  )
  const lockedKeys = new Set(
    lock.lockfile.sources.map((source) => `${source.kind}\0${source.id}`),
  )
  const prospectiveLock = {
    lockfileVersion: 1 as const,
    sources: [
      ...lock.lockfile.sources.map((source) => {
        const selectedSource = selectedCurrentSources.get(
          `${source.kind}\0${source.id}`,
        )
        if (!selectedSource) return source
        const selectedPaths = new Set(
          selectedSource.skills.map((skill) => skill.path),
        )
        return {
          ...source,
          skills: [
            ...source.skills.filter((skill) => !selectedPaths.has(skill.path)),
            ...selectedSource.skills,
          ],
        }
      }),
      ...[...selectedCurrentSources.entries()]
        .filter(([key]) => !lockedKeys.has(key))
        .map(([, source]) => source),
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
  if (hasNonNativeLinkSource(expected, readFs)) {
    fail(
      'Archive-backed/PnP sources cannot use symlink delivery; use hooks instead by setting intent.install.method to "hooks".',
    )
  }
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
  if (links.conflicts.length > 0) {
    fail(
      `Intent sync found managed link conflicts: ${links.conflicts
        .map((path) => toProjectRelativePath(root, path))
        .join(', ')}.`,
    )
  }
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
  const stateResult = readInstallStateForLinks(root)
  if (stateResult.status === 'malformed') {
    fail(
      `Intent install state is malformed at ${INSTALL_STATE_PATH}. Restore a valid copy, or remove the existing Intent-managed links and ${INSTALL_STATE_PATH}, then run \`intent install\` again.`,
    )
  }

  let discovery: ReturnType<typeof scanForConfiguredIntents>
  let plan: ReturnType<typeof buildSyncLinkPlan>
  const fsCache = createIntentFsCache()
  try {
    discovery = scanForConfiguredIntents({
      root,
      config: parseSkillSources(config.skills),
      exclude: config.exclude,
      fsCache,
    })
    plan = buildSyncLinkPlan({
      config,
      currentSources: buildCurrentLockfileSources(
        discovery.policy.packages,
        fsCache.getReadFs(),
      ),
      discovered: discovery.discovered,
      lock,
      packages: discovery.policy.packages,
      root,
    })
  } catch (error) {
    if (stateResult.status === 'missing') throw error
    const links = reconcileManagedLinks({
      dryRun: options.dryRun === true,
      expected: [],
      stateResult,
    })
    if (!options.dryRun) {
      writeManagedLinkState(root, links)
    }
    if (links.conflicts.length > 0) {
      throw new Error(
        `Intent sync could not revoke managed links after verification failed: ${links.conflicts
          .map((path) => toProjectRelativePath(root, path))
          .join(', ')}.`,
        { cause: error },
      )
    }
    throw error
  }
  const { discovered, policy } = discovery
  const { expected, inventory } = plan
  if (hasNonNativeLinkSource(expected, fsCache.getReadFs())) {
    fail(
      'Archive-backed/PnP sources cannot use symlink delivery; use hooks instead by setting intent.install.method to "hooks".',
    )
  }
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
  const interactiveReview =
    summaries.newDependencies.length > 0 &&
    shouldReviewInteractively(options, runtime)
  const preflight = reconcileManagedLinks({
    dryRun: true,
    expected,
    stateResult,
  })
  if (preflight.conflicts.length > 0) {
    const reportedLinks = options.dryRun
      ? preflight
      : { ...preflight, created: [], repaired: [], removed: [] }
    output(
      buildSyncCommandResult(root, reportedLinks, summaries),
      options.json === true,
      false,
    )
    fail(
      `Intent sync found managed link conflicts: ${preflight.conflicts
        .map((path) => toProjectRelativePath(root, path))
        .join(', ')}.`,
    )
  }
  const links = options.dryRun
    ? preflight
    : reconcileManagedLinks({
        dryRun: false,
        expected,
        stateResult,
      })
  if (!options.dryRun) {
    writeManagedLinkState(root, links)
  }
  const result = buildSyncCommandResult(root, links, summaries)
  if (links.conflicts.length > 0) {
    output(result, options.json === true, false)
    fail(
      `Intent sync found managed link conflicts: ${links.conflicts
        .map((path) => toProjectRelativePath(root, path))
        .join(', ')}.`,
    )
  }
  output(result, options.json === true, interactiveReview)
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
    const reviewedKeys = new Set(packages.map(sourceKey))
    const enabledSkills = new Map(
      policy.packages.map((pkg) => [
        sourceKey(pkg),
        new Set(pkg.skills.map((skill) => skill.name)),
      ]),
    )
    const reviewedPackages = discovered.flatMap((pkg) => {
      const key = sourceKey(pkg)
      if (!reviewedKeys.has(key)) return []
      const pending = pendingSkills.get(key)
      const enabled = enabledSkills.get(key)
      return [
        {
          ...pkg,
          skills: pkg.skills.filter(
            (skill) =>
              pending?.has(skill.name) === true ||
              enabled?.has(skill.name) === true,
          ),
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
      reviewedPackages,
      prompts,
      readFs: fsCache.getReadFs(),
      root,
    })
  }
}
