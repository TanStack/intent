import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { projectPath } from '../maintainer/project.js'
import { createReview, recordReview } from './review.js'
import type { ReviewReport } from './review.js'

type ReviewItem = ReviewReport['items'][number]

export type ReviewDecision =
  | { outcome: 'unresolved' }
  | {
      outcome: 'updated' | 'no-change' | 'out-of-scope'
      reason: string
      evidence: Array<string>
    }

export interface ReviewPrompts {
  reviewItem: (
    item: ReviewItem,
    inspect: (view: 'guidance' | 'changes') => string,
  ) => Promise<ReviewDecision | null>
  confirm: (report: ReviewReport) => Promise<boolean>
}

function inspectItem(
  report: ReviewReport,
  item: ReviewItem,
  view: 'guidance' | 'changes',
): string {
  const read = (path: string) => {
    const absolute = projectPath(report.root, path)
    return `\n${JSON.stringify(path)}\n${
      existsSync(absolute) ? readFileSync(absolute, 'utf8') : '(deleted)'
    }`
  }
  if (view === 'guidance') {
    if (item.kind === 'skill') return read(item.path)
    if (item.kind === 'planning')
      return Object.keys(item.snapshot)
        .filter((path) =>
          ['domain_map.yaml', 'skill_tree.yaml', 'skill_spec.md'].some(
            (name) => path === name || path.endsWith(`/${name}`),
          ),
        )
        .map(read)
        .join('\n')
    return 'This source change has no mapped skill.'
  }
  if (!item.changedFiles.length)
    return 'No files changed from the comparison base. This item has no current review outcome.'
  for (const path of item.changedFiles) projectPath(report.root, path)
  const git = (args: Array<string>) =>
    execFileSync(
      'git',
      ['-c', 'core.fsmonitor=false', '--literal-pathspecs', ...args],
      {
        cwd: report.root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  const diff = git([
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    report.base,
    '--',
    ...item.changedFiles,
  ])
  const untracked = git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ...item.changedFiles,
  ])
    .split('\0')
    .filter(Boolean)
  return (
    [diff, ...untracked.map(read)].filter(Boolean).join('\n') ||
    'No diff against the comparison base. Inspect the current guidance and listed source files.'
  )
}

export async function runInteractiveReview(
  cwd: string,
  base: string | undefined,
  prompts: ReviewPrompts,
): Promise<void> {
  const report = createReview(cwd, base)
  if (!report.items.length) {
    console.log('No pending review items.')
    return
  }
  console.log(
    `${report.items.length} item(s) need review. Base: ${report.base}`,
  )
  for (const item of report.items) {
    const decision = await prompts.reviewItem(structuredClone(item), (view) =>
      inspectItem(report, item, view),
    )
    if (decision === null) {
      console.log('Review canceled. No outcomes recorded.')
      return
    }
    Object.assign(item, decision)
  }
  if (report.items.every((item) => item.outcome === 'unresolved')) {
    console.log('All review items remain pending. No outcomes recorded.')
    return
  }
  if (!(await prompts.confirm(structuredClone(report)))) {
    console.log('Review canceled. No outcomes recorded.')
    return
  }
  const count = recordReview(cwd, report)
  const pending = createReview(cwd, base).items.length
  console.log(
    `Recorded ${count} review outcome(s). ${pending} item(s) remain pending.`,
  )
}
