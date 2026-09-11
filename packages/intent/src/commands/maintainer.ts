import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { isCI } from 'std-env'
import { resolveProjectContext } from '../core/project-context.js'
import { fail } from '../shared/cli-error.js'
import {
  readRecord,
  resolveMaintainerProject,
  setupRecords,
} from '../maintainer/project.js'
import { addSkill } from '../maintainer/add.js'
import { createAdoptionPlan, planAdoptionChanges } from '../maintainer/adopt.js'
import { planMaintainerSync } from '../maintainer/sync.js'
import { withMaintainerLock, writeChanges } from '../maintainer/files.js'
import { createReview } from '../review/review.js'
import {
  configureDistribution,
  distributionChoice,
  readDistribution,
} from '../maintainer/distribution.js'
import { detectIntentCommandPackageManager } from '../shared/command-runner.js'
import {
  buildMaintainerGuidanceBlock,
  writeIntentSkillsBlock,
} from './install/guidance.js'
import { runReviewCommand } from './review.js'
import { runValidateCommand } from './validate.js'
import type { DistributionOptions } from '../maintainer/distribution.js'
import type { AdoptionPrompts } from '../maintainer/adopt.js'
import type { ReviewPrompts } from '../review/interactive.js'

export interface MaintainerCommandRuntime {
  isTTY?: boolean
  isCI?: boolean
  adoptionPrompts?: AdoptionPrompts
  reviewPrompts?: ReviewPrompts
}

export interface MaintainerCommandOptions extends DistributionOptions {
  artifacts?: string
  package?: string
  path?: string
  domain?: string
  description?: string
  source?: string | Array<string>
  requires?: string | Array<string>
  base?: string
  json?: boolean
  record?: string
  apply?: string
  interactive?: boolean
}

// An explicit --package is repository-relative. Without one, a command run from
// inside a workspace member registers the skill with that member instead of
// silently placing it at the repository root.
function inferOwningPackage(
  root: string,
  explicit: string | undefined,
): string | undefined {
  if (explicit !== undefined) return explicit
  const { packageRoot } = resolveProjectContext({ cwd: process.cwd() })
  if (!packageRoot || packageRoot === root) return undefined
  const owner = relative(root, packageRoot).replaceAll('\\', '/')
  if (!owner || owner.startsWith('..')) return undefined
  return owner
}

export async function runMaintainerCommand(
  action: string,
  name: string | undefined,
  options: MaintainerCommandOptions,
  runtime: MaintainerCommandRuntime = {},
): Promise<void> {
  const allowed: Record<string, Array<string>> = {
    setup: ['artifacts', 'distribution', 'repository', 'pluginName', 'skill'],
    adopt: ['artifacts', 'json', 'path', 'apply'],
    add: [
      'artifacts',
      'package',
      'path',
      'domain',
      'description',
      'source',
      'requires',
    ],
    status: ['artifacts', 'base', 'json'],
    sync: ['artifacts'],
    review: ['base', 'json', 'record', 'interactive'],
    check: ['artifacts', 'base'],
  }
  if (!allowed[action])
    fail(
      `Unknown maintainer action: ${action}. Expected setup, adopt, add, status, sync, review, or check.`,
    )
  if (name !== undefined && action !== 'add')
    fail(`maintainer ${action} does not take a skill name.`)
  for (const key of Object.keys(options)) {
    if (key !== '--' && !allowed[action].includes(key))
      fail(`--${key} is not supported by maintainer ${action}.`)
  }
  if (action === 'review') {
    if (options.interactive) {
      if (options.json || options.record)
        fail('--interactive cannot be combined with --json or --record.')
      if (
        (runtime.isCI ?? isCI) ||
        !(runtime.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY))
      )
        fail(
          'Interactive review requires a human terminal outside CI. Use --json for a report or maintainer check for a CI gate.',
        )
      const { runInteractiveReview } = await import('../review/interactive.js')
      const prompts =
        runtime.reviewPrompts ??
        (await import('../review/prompts.js')).createReviewPrompts()
      await runInteractiveReview(process.cwd(), options.base, prompts)
      return
    }
    runReviewCommand(undefined, options)
    return
  }
  const project = resolveMaintainerProject(process.cwd(), options.artifacts)
  if (action === 'adopt') {
    let input: unknown
    if (options.apply) {
      if (options.json || options.path)
        fail('--apply cannot be combined with --json or --path.')
      input = JSON.parse(readFileSync(resolve(options.apply), 'utf8'))
    } else {
      const plan = createAdoptionPlan(project, options.path)
      if (options.json) {
        console.log(JSON.stringify(plan, null, 2))
        return
      }
      if (
        (runtime.isCI ?? isCI) ||
        !(runtime.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY))
      )
        fail(
          'Use maintainer adopt --json to preview, then --apply <plan.json> with explicit choices in noninteractive sessions.',
        )
      for (const skill of plan.skills)
        console.log(
          `${JSON.stringify(skill.id)}: ${skill.status}${skill.problems.length ? ` (${skill.problems.join('; ')})` : ''}`,
        )
      const prompts =
        runtime.adoptionPrompts ??
        (
          await import('../maintainer/adoption-prompts.js')
        ).createAdoptionPrompts()
      const chosen = await prompts.choose(plan)
      if (chosen === null) {
        console.log('Adoption canceled. No files changed.')
        return
      }
      const preview = planAdoptionChanges(project, chosen)
      const files = preview.changes.map((change) =>
        relative(project.root, change.path),
      )
      if (!(await prompts.confirm(chosen, files))) {
        console.log('Adoption canceled. No files changed.')
        return
      }
      input = chosen
    }
    await withMaintainerLock(project.root, () => {
      const plan = planAdoptionChanges(project, input)
      writeChanges(project.root, plan.changes)
      writeIntentSkillsBlock({
        ...buildMaintainerGuidanceBlock(
          detectIntentCommandPackageManager(project.root),
        ),
        root: project.root,
        namespace: 'intent-maintainer',
        skipWhenEmpty: false,
      })
      console.log(
        `Registered ${plan.paths.length} skill(s). Authored task coverage and source review remain required.`,
      )
    })
    return
  }
  if (['setup', 'add', 'sync'].includes(action)) {
    await withMaintainerLock(project.root, () => {
      if (action === 'setup') {
        const created = setupRecords(project)
        configureDistribution(project, options)
        writeIntentSkillsBlock({
          ...buildMaintainerGuidanceBlock(
            detectIntentCommandPackageManager(project.root),
          ),
          root: project.root,
          namespace: 'intent-maintainer',
          skipWhenEmpty: false,
        })
        console.log(
          `Maintainer records: ${project.artifacts} (${created.length} created).`,
        )
        console.log(
          'Next: intent maintainer add <name> --domain <domain> --description <activation> --source <path>. Use --package <directory> for a workspace package. Use intent meta generate-skill for the authoring procedure.',
        )
        console.log(
          'For existing skills, run intent maintainer adopt to review registrations.',
        )
        const distribution = readDistribution(
          readRecord(project, 'skill_tree.yaml'),
        )
        if (!distribution) console.log(distributionChoice)
        console.log(
          `Repository distribution: ${distribution?.mode ?? 'unconfigured'}. Run maintainer sync after authoring to update export metadata.`,
        )
      } else if (action === 'add') {
        const owner = inferOwningPackage(project.root, options.package)
        console.log(
          `Registered ${addSkill(project, name, { ...options, package: owner })}.`,
        )
        console.log(
          'Next: author the skill and its task coverage, then run intent maintainer sync, maintainer review, and maintainer check.',
        )
      } else {
        const plan = planMaintainerSync(project)
        writeChanges(project.root, plan.changes)
        console.log(`Synchronized ${plan.changes.length} file(s).`)
        for (const problem of plan.problems)
          console.log(`Remaining: ${problem}`)
        for (const command of plan.distribution.commands) console.log(command)
      }
    })
    return
  }
  const plan = planMaintainerSync(project)
  const review = createReview(project.root, options.base)
  const status = {
    schemaVersion: 1,
    root: project.root,
    artifacts: project.artifacts,
    skills: plan.skills.map((path) => relative(project.root, path)),
    staleFiles: plan.changes.map((change) =>
      relative(project.root, change.path),
    ),
    problems: plan.problems,
    distribution: {
      mode: plan.distribution.mode,
      commands: plan.distribution.commands,
    },
    review,
  }
  if (options.json) console.log(JSON.stringify(status, null, 2))
  else {
    console.log(
      `${status.skills.length} skill(s), ${status.staleFiles.length} file(s) to sync, ${status.problems.length} authoring issue(s), ${review.items.length} pending review item(s).`,
    )
    for (const problem of status.problems) console.log(`  ${problem}`)
    for (const path of status.staleFiles)
      console.log(`  Run intent maintainer sync: ${path}`)
    for (const item of review.items)
      console.log(
        `  Review ${item.path}${item.problems.length ? `: ${item.problems.join('; ')}` : ''}`,
      )
  }
  if (action === 'check') {
    for (const dir of new Set(plan.skills.map(dirname)))
      await runValidateCommand(dir)
    if (plan.problems.length || plan.changes.length || review.items.length)
      fail(
        'Maintainer check failed. Resolve the authoring issues, run intent maintainer sync, and record review outcomes with intent maintainer review --interactive, or annotate a --json report and pass it to --record <report.json>.',
      )
    console.log(
      'Maintainer checks passed. Recorded conclusions still depend on the supplied review evidence.',
    )
  }
}
