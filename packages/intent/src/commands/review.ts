import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createReview, recordReview } from '../review/review.js'
import { fail, isCliFailure } from '../shared/cli-error.js'
import { writeStaleReviewWorkflowFiles } from '../staleness/workflow-review.js'

export interface ReviewCommandOptions {
  base?: string
  json?: boolean
  record?: string
  check?: boolean
  githubReview?: boolean
  packageLabel?: string
}

export function runReviewCommand(
  dir: string | undefined,
  options: ReviewCommandOptions,
): void {
  try {
    const cwd = resolve(dir ?? process.cwd())
    if (
      options.githubReview &&
      (options.json || options.record || options.check)
    )
      throw new Error(
        '--github-review cannot be combined with --json, --record or --check.',
      )
    if (options.record) {
      if (options.base || options.json || options.check)
        throw new Error(
          '--record cannot be combined with --base, --json or --check.',
        )
      const count = recordReview(
        cwd,
        JSON.parse(readFileSync(resolve(options.record), 'utf8')),
      )
      console.log(`Recorded ${count} review outcome(s).`)
      return
    }
    const report = createReview(cwd, options.base)
    if (options.githubReview) {
      writeStaleReviewWorkflowFiles(
        report.items.map((item) => ({
          type:
            item.kind === 'source'
              ? 'unmapped-change'
              : item.kind === 'planning'
                ? 'planning-review'
                : 'source-review',
          library: options.packageLabel ?? 'workspace',
          subject: item.path,
          reasons: item.problems.length
            ? item.problems
            : [
                item.changedFiles.length
                  ? `Unreviewed changes: ${item.changedFiles.join(', ')}`
                  : 'No recorded review for this guidance.',
              ],
        })),
      )
      console.log(`Wrote ${report.items.length} source review item(s).`)
      return
    }
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(`${report.items.length} item(s) need skill review.`)
      for (const item of report.items.slice(0, 20)) {
        console.log(
          `  ${item.kind === 'skill' ? 'Skill' : item.kind === 'planning' ? 'Planning records' : 'Unmapped change'}: ${JSON.stringify(item.path)}`,
        )
        for (const problem of item.problems)
          console.log(`    Unknown: ${problem}`)
        if (item.changedFiles.length)
          console.log(
            `    Changed: ${item.changedFiles.map((path) => JSON.stringify(path)).join(', ')}`,
          )
      }
      if (report.items.length > 20)
        console.log('  Use --json for all review items.')
      if (report.items.length)
        console.log(
          'Next: run intent meta generate-skill in your coding agent. Review the evidence, run task checks, and record justified outcomes with intent review --record <report.json>.',
        )
      else
        console.log(
          'No unreviewed changes detected. Recorded outcomes are review evidence, not a guarantee of semantic correctness.',
        )
    }
    if (options.check && report.items.length > 0)
      fail(`${report.items.length} item(s) need skill review.`)
  } catch (error) {
    if (isCliFailure(error)) throw error
    if (
      options.githubReview &&
      !options.json &&
      !options.record &&
      !options.check
    ) {
      writeStaleReviewWorkflowFiles([
        {
          type: 'review-check-failed',
          library: options.packageLabel ?? 'workspace',
          subject: 'intent review',
          reasons: [error instanceof Error ? error.message : String(error)],
        },
      ])
      console.log(
        'Source review failed; wrote a review reminder with the missing evidence.',
      )
      return
    }
    fail(error instanceof Error ? error.message : String(error))
  }
}
