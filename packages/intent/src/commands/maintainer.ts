import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { isCI } from 'std-env'
import { fail } from '../shared/cli-error.js'
import {
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

export interface MaintainerCommandRuntime {
  isTTY?: boolean
  isCI?: boolean
  adoptionPrompts?: AdoptionPrompts
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
    review: ['base', 'json', 'record'],
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
        const distribution = readDistribution(project)
        if (!distribution) console.log(distributionChoice)
        console.log(
          `Repository distribution: ${distribution?.mode ?? 'unconfigured'}. Run maintainer sync after authoring to update export metadata.`,
        )
      } else if (action === 'add') {
        console.log(`Registered ${addSkill(project, name, options)}.`)
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
        'Maintainer check failed. Resolve the authoring issues, run maintainer sync, and record review outcomes with maintainer review --record <report.json>.',
      )
    console.log(
      'Maintainer checks passed. Recorded conclusions still depend on the supplied review evidence.',
    )
  }
}
