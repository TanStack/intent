import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import { compileExcludePatterns } from '../../core/excludes.js'
import { createIntentFsCache } from '../../discovery/fs-cache.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { sourceIdentityKey } from '../../core/types.js'
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
import {
  DELIVERY_CONFIG_PATH,
  readIntentDeliveryConfig,
} from '../install/delivery.js'
import {
  buildSkillSelectionPlan,
  skillSelectionId,
  summarizeInstallDeltaInventory,
} from '../install/plan.js'
import { writeIntentGitExclude } from './gitignore.js'
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

function writeManagedLinkState(root: string, links: LinkReconciliation): void {
  const entries = links.entries.map((entry) => ({
    ...entry,
    path: toProjectRelativePath(root, entry.path),
  }))
  writeInstallState(root, { version: 1, entries })
  writeIntentGitExclude(root, [
    ...entries.map((entry) => entry.path),
    DELIVERY_CONFIG_PATH,
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
  deliveryTargets,
  discovered,
  lock,
  packages,
  reviewedPackages,
  prompts,
  readFs,
  root,
}: {
  config: ReturnType<typeof readIntentConsumerConfig>
  deliveryTargets: NonNullable<
    ReturnType<typeof readIntentDeliveryConfig>
  >['targets']
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
      pkg.skills.map((skill) => skillSelectionId(pkg, skill)),
    ),
  )
  const selectionPlan = buildSkillSelectionPlan(reviewedPackages, {
    ...selection,
    enabled: [
      ...new Set([
        ...selection.enabled,
        ...reviewedPackages.flatMap((pkg) =>
          pkg.skills
            .map((skill) => skillSelectionId(pkg, skill))
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
        .filter((skill) => selectedPendingIds.has(skillSelectionId(pkg, skill)))
        .map((skill) => `skills/${skill.name}`)
      return paths.length > 0
        ? [
            [
              sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
              new Set(paths),
            ] as const,
          ]
        : []
    }),
  )
  const selectedCurrentSources = new Map(
    currentSources.flatMap((source) => {
      const key = sourceIdentityKey(source)
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
    lock.lockfile.sources.map((source) => sourceIdentityKey(source)),
  )
  const prospectiveLock = {
    lockfileVersion: 1 as const,
    sources: [
      ...lock.lockfile.sources.map((source) => {
        const selectedSource = selectedCurrentSources.get(
          sourceIdentityKey(source),
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
    targets: deliveryTargets,
  }).expected
  if (hasNonNativeLinkSource(expected, readFs)) {
    fail(
      'Archive-backed/PnP sources cannot use symlink delivery; use hooks instead by setting intent.install.method to "hooks".',
    )
  }
  const stateResult = readInstallStateForLinks(root)
  const preflight = reconcileManagedLinks({
    root,
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
    root,
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
  const delivery = readIntentDeliveryConfig(root)
  if (!delivery) {
    console.error(
      'Intent skill delivery is not configured for this checkout. Run `intent install` to configure it.',
    )
    return
  }
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) {
    fail(
      'Intent sync requires package policy and intent.lock. Run `intent install` first.',
    )
  }
  const packageJson = readFileSync(packageJsonPath, 'utf8')
  const config = readIntentConsumerConfig(packageJson)
  const lock = readIntentLockfile(join(root, 'intent.lock'))
  if (lock.status !== 'found') {
    fail(
      'Intent sync requires package policy and intent.lock. Run `intent install` first.',
    )
  }
  if (delivery.method !== 'symlink') {
    fail(
      'Hook delivery is repaired by `intent install`; run it to repair configured hooks.',
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
      targets: delivery.targets,
    })
  } catch (error) {
    if (stateResult.status === 'missing') throw error
    const links = reconcileManagedLinks({
      root,
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
  const { newDependencies, newSkills, changed } =
    summarizeInstallDeltaInventory(inventory)
  const summaries = { newDependencies, newSkills, changed }
  const interactiveReview =
    summaries.newDependencies.length > 0 &&
    shouldReviewInteractively(options, runtime)
  const preflight = reconcileManagedLinks({
    root,
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
        root,
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
        sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
        new Set(
          pkg.skills
            .filter((skill) => skill.policy === 'pending')
            .map((skill) => skill.id.slice(skill.id.indexOf('#') + 1)),
        ),
      ]),
    )
    const packages = discovered.flatMap((pkg) => {
      const skills = pendingSkills.get(
        sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
      )
      if (!skills || skills.size === 0) return []
      return [
        {
          ...pkg,
          skills: pkg.skills.filter((skill) => skills.has(skill.name)),
        },
      ]
    })
    const reviewedKeys = new Set(
      packages.map((pkg) =>
        sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
      ),
    )
    const enabledSkills = new Map(
      policy.packages.map((pkg) => [
        sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
        new Set(pkg.skills.map((skill) => skill.name)),
      ]),
    )
    const reviewedPackages = discovered.flatMap((pkg) => {
      const key = sourceIdentityKey({ kind: pkg.kind, id: pkg.name })
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
      deliveryTargets: delivery.targets,
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
