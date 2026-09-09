import { dirname, relative } from 'node:path'
import { fail } from '../shared/cli-error.js'
import {
  resolveMaintainerProject,
  setupRecords,
} from '../maintainer/project.js'
import { addSkill } from '../maintainer/add.js'
import { planMaintainerSync } from '../maintainer/sync.js'
import { withMaintainerLock, writeChanges } from '../maintainer/files.js'
import { createReview } from '../review/review.js'
import { detectIntentCommandPackageManager } from '../shared/command-runner.js'
import {
  buildMaintainerGuidanceBlock,
  writeIntentSkillsBlock,
} from './install/guidance.js'
import { runReviewCommand } from './review.js'
import { runValidateCommand } from './validate.js'

export interface MaintainerCommandOptions {
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
}

export async function runMaintainerCommand(
  action: string,
  name: string | undefined,
  options: MaintainerCommandOptions,
): Promise<void> {
  const allowed: Record<string, Array<string>> = {
    setup: ['artifacts'],
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
      `Unknown maintainer action: ${action}. Expected setup, add, status, sync, review, or check.`,
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
  if (['setup', 'add', 'sync'].includes(action)) {
    await withMaintainerLock(project.root, () => {
      if (action === 'setup') {
        const created = setupRecords(project)
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
