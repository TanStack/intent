import { dirname, relative } from 'node:path'
import { isCI } from 'std-env'
import { resolveProjectContext } from '../core/project-context.js'
import { fail } from '../shared/cli-error.js'
import {
  readRecord,
  resolveMaintainerProject,
  setupRecords,
} from '../maintainer/project.js'
import { addSkill, planAddSkills } from '../maintainer/add.js'
import { findExistingSkills } from '../maintainer/existing.js'
import { retireSkill } from '../maintainer/remove.js'
import { planMaintainerSync } from '../maintainer/sync.js'
import { withMaintainerLock, writeChanges } from '../maintainer/files.js'
import { createReview } from '../review/review.js'
import {
  configureDistribution,
  readDistribution,
} from '../maintainer/distribution.js'
import { runSetupGithubActions } from '../setup/index.js'
import { detectIntentCommandPackageManager } from '../shared/command-runner.js'
import { getMetaDir } from './support.js'
import {
  buildMaintainerGuidanceBlock,
  writeIntentSkillsBlock,
} from './install/guidance.js'
import { runReviewCommand } from './review.js'
import { runValidateCommand } from './validate.js'
import type { DistributionOptions } from '../maintainer/distribution.js'
import type { ReviewPrompts } from '../review/interactive.js'

export interface MaintainerCommandRuntime {
  isTTY?: boolean
  isCI?: boolean
  reviewPrompts?: ReviewPrompts
}

interface MaintainerAction {
  usage: string
  summary: string
  writes: string
  options: Array<[flag: string, description: string]>
}

const optionHelp: Record<string, [flag: string, description: string]> = {
  artifacts: [
    '--artifacts <directory>',
    'Planning record directory, relative to the repository root',
  ],
  package: [
    '--package <directory>',
    'Owning package directory, relative to the repository root (default: the package that owns the current directory)',
  ],
  path: ['--path <path>', 'Skill path relative to the owning package'],
  domain: ['--domain <slug>', 'Task domain for the skill'],
  distribution: [
    '--distribution <mode>',
    'repo to distribute selected skills from the repository, none to opt out',
  ],
  repository: [
    '--repository <owner/repo>',
    'GitHub repository for distribution',
  ],
  pluginName: ['--plugin-name <name>', 'Name for the generated skill plugin'],
  skill: ['--skill <name>', 'Skill to distribute; repeat to select more'],
  description: [
    '--description <text>',
    'Activation description for a new skill',
  ],
  source: ['--source <path>', 'Source evidence path; repeat for more'],
  requires: ['--requires <name>', 'Prerequisite skill; repeat for more'],
  task: ['--task <text>', 'Developer task the skill covers; repeat for more'],
  base: ['--base <ref>', 'Git revision to review against'],
  interactive: ['--interactive', 'Inspect and record outcomes in a terminal'],
  json: ['--json', 'Print JSON instead of text'],
  record: ['--record <file>', 'Record outcomes from an annotated JSON report'],
}

// Ordered as a maintainer runs them. `maintainer --help` prints this table and
// `maintainer <action> --help` prints one entry.
export const maintainerActions: Record<string, MaintainerAction> = {
  setup: {
    usage: 'maintainer setup [--distribution repo|none] [options]',
    summary:
      'Initialize planning records, register existing skills, install agent instructions and CI.',
    writes:
      'skill_tree.yaml, domain_map.yaml, skill_spec.md (registering any SKILL.md under skills/ that is not yet recorded), the intent-maintainer block in AGENTS.md (or the existing agent instruction file), and .github/workflows/check-skills.yml when it does not exist.',
    options: [
      'artifacts',
      'distribution',
      'repository',
      'pluginName',
      'skill',
    ].map((key) => optionHelp[key]!),
  },
  add: {
    usage:
      'maintainer add <name> --domain <slug> [--description <text> --source <path>...] [options]',
    summary: 'Create a skill skeleton or register an existing SKILL.md.',
    writes:
      'skills/<name>/SKILL.md beside the owning package, plus its entries in skill_tree.yaml, domain_map.yaml, and skill_spec.md.',
    options: [
      'artifacts',
      'package',
      'path',
      'domain',
      'description',
      'source',
      'requires',
      'task',
    ].map((key) => optionHelp[key]!),
  },
  remove: {
    usage: 'maintainer remove <name>',
    summary: 'Retire a registered skill without deleting its guidance.',
    writes:
      'The entry status in skill_tree.yaml and a note in skill_spec.md. Delete the SKILL.md yourself once its guidance is no longer needed.',
    options: ['artifacts'].map((key) => optionHelp[key]!),
  },
  status: {
    usage: 'maintainer status [--json] [--base <ref>]',
    summary: 'Report authoring gaps, files to sync, and pending reviews.',
    writes: 'Nothing.',
    options: ['artifacts', 'base', 'json'].map((key) => optionHelp[key]!),
  },
  sync: {
    usage: 'maintainer sync',
    summary:
      'Align the skill tree and package metadata with SKILL.md frontmatter.',
    writes:
      'skill_tree.yaml, package.json keywords and files, and generated distribution files when repository distribution is selected.',
    options: ['artifacts'].map((key) => optionHelp[key]!),
  },
  review: {
    usage:
      'maintainer review [--json | --interactive | --record <report.json>] [--base <ref>]',
    summary: 'Find guidance affected by Git changes and record outcomes.',
    writes: '.intent/review-state.json when recording; nothing otherwise.',
    options: ['base', 'json', 'record', 'interactive'].map(
      (key) => optionHelp[key]!,
    ),
  },
  check: {
    usage: 'maintainer check [--base <ref>]',
    summary:
      'Fail when authoring issues, stale generated files, or pending reviews remain.',
    writes: 'Nothing. Use it as the CI gate.',
    options: ['artifacts', 'base'].map((key) => optionHelp[key]!),
  },
}

export function maintainerHelp(action?: string): string {
  const lines: Array<string> = []
  const entries = action
    ? [[action, maintainerActions[action]!] as const]
    : Object.entries(maintainerActions)
  if (!action) {
    lines.push(
      'Usage: intent maintainer <action> [options]',
      '',
      'Run the actions in this order. Each one is safe to rerun.',
      '',
    )
  }
  for (const [name, entry] of entries) {
    lines.push(`${action ? 'Usage: intent ' : `${name}: `}${entry.usage}`)
    lines.push(`  ${entry.summary}`)
    lines.push(`  Writes: ${entry.writes}`)
    if (action) {
      lines.push('', 'Options:')
      for (const [flag, description] of entry.options)
        lines.push(`  ${flag.padEnd(28)} ${description}`)
    } else lines.push('')
  }
  if (!action)
    lines.push(
      'Run intent maintainer <action> --help for the options of one action.',
    )
  return lines.join('\n')
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

export interface MaintainerCommandOptions extends DistributionOptions {
  artifacts?: string
  package?: string
  path?: string
  domain?: string
  description?: string
  source?: string | Array<string>
  requires?: string | Array<string>
  task?: string | Array<string>
  base?: string
  json?: boolean
  record?: string
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
    add: [
      'artifacts',
      'package',
      'path',
      'domain',
      'description',
      'source',
      'requires',
      'task',
    ],
    remove: ['artifacts'],
    status: ['artifacts', 'base', 'json'],
    sync: ['artifacts'],
    review: ['base', 'json', 'record', 'interactive'],
    check: ['artifacts', 'base'],
  }
  if (!allowed[action])
    fail(
      `Unknown maintainer action: ${action}. Expected setup, add, remove, status, sync, review, or check.`,
    )
  if (name !== undefined && action !== 'add' && action !== 'remove')
    fail(`maintainer ${action} does not take a skill name.`)
  for (const key of Object.keys(options)) {
    if (key !== '--' && !allowed[action].includes(key))
      fail(
        `--${kebab(key)} is not supported by maintainer ${action}. Run intent maintainer ${action} --help for its options.`,
      )
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
  if (['setup', 'add', 'remove', 'sync'].includes(action)) {
    await withMaintainerLock(project.root, () => {
      if (action === 'setup') {
        const created = setupRecords(project)
        configureDistribution(project, options)
        const existing = findExistingSkills(project)
        // Register one skill at a time so a candidate the planner rejects is
        // reported as skipped instead of aborting the others.
        let registered: ReturnType<typeof planAddSkills> = {
          changes: [],
          paths: [],
        }
        for (const skill of existing) {
          if (skill.problems.length) continue
          try {
            registered = planAddSkills(
              project,
              [
                {
                  name: skill.name,
                  options: {
                    package: skill.package || undefined,
                    path: skill.path,
                    domain: skill.domain,
                  },
                },
              ],
              registered.changes,
            )
          } catch (error) {
            skill.problems.push(
              error instanceof Error ? error.message : String(error),
            )
          }
        }
        writeChanges(project.root, registered.changes)
        runSetupGithubActions(project.root, getMetaDir())
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
        for (const skill of existing)
          console.log(
            skill.problems.length
              ? `Skipped ${skill.id}: ${skill.problems.join(' ')}`
              : `Registered ${skill.id} (domain ${skill.domain}).`,
          )
        if (existing.some((skill) => skill.domain === 'uncategorized'))
          console.log(
            `Set a domain for uncategorized skills in ${project.artifacts}/skill_tree.yaml and domain_map.yaml.`,
          )
        const distribution = readDistribution(
          readRecord(project, 'skill_tree.yaml'),
        )
        console.log(
          distribution
            ? `Repository distribution: ${distribution.mode}. Run maintainer sync after authoring to update export metadata.`
            : 'Repository distribution: none (default). To also offer selected skills from the repository, run maintainer setup --distribution repo --skill <name> after authoring.',
        )
      } else if (action === 'add') {
        const owner = inferOwningPackage(project.root, options.package)
        const added = addSkill(project, name, { ...options, package: owner })
        console.log(`Registered ${added.path}.`)
        console.log(`Updated: ${added.files.join(', ')}`)
        console.log(
          `Next: author the guidance with intent meta generate-skill, record its developer tasks in ${project.artifacts}/domain_map.yaml, then run intent maintainer sync, intent maintainer review, and intent maintainer check.`,
        )
      } else if (action === 'remove') {
        const retired = retireSkill(project, name)
        console.log(`Retired ${name}.`)
        console.log(`Updated: ${retired.files.join(', ')}`)
        console.log(
          retired.exists
            ? `Delete ${retired.path} when its guidance is no longer needed, then run intent maintainer sync and intent maintainer review.`
            : 'Run intent maintainer sync and intent maintainer review.',
        )
      } else {
        const plan = planMaintainerSync(project)
        writeChanges(project.root, plan.changes)
        if (plan.changes.length === 0) console.log('Nothing to synchronize.')
        for (const change of plan.changes)
          console.log(
            `Synchronized ${relative(project.root, change.path).replaceAll('\\', '/')}`,
          )
        for (const problem of plan.problems)
          console.log(`Remaining: ${problem}`)
        if (plan.distribution.commands.length)
          console.log('Consumers install the selected repository skills with:')
        for (const command of plan.distribution.commands)
          console.log(`  ${command}`)
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
    skills: plan.skills.map((path) =>
      relative(project.root, path).replaceAll('\\', '/'),
    ),
    staleFiles: plan.changes.map((change) =>
      relative(project.root, change.path).replaceAll('\\', '/'),
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
    for (const item of review.items) {
      const label =
        item.kind === 'skill'
          ? 'Review skill'
          : item.kind === 'planning'
            ? 'Review planning records'
            : 'Review unmapped change'
      const detail = item.problems.length
        ? item.problems.join('; ')
        : item.changedFiles.length
          ? `changed ${item.changedFiles.join(', ')}`
          : 'no recorded review'
      console.log(`  ${label} ${item.path}: ${detail}`)
    }
  }
  if (action === 'check') {
    // Validate each skills root once instead of once per skill directory.
    for (const dir of new Set(
      plan.skills.map((path) => dirname(dirname(path))),
    ))
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
