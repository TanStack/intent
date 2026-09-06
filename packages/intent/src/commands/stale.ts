import { resolve } from 'node:path'
import {
  compileExcludePatterns,
  getEffectiveExcludePatterns,
  isSkillExcluded,
} from '../core/excludes.js'
import { resolveProjectContext } from '../core/project-context.js'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import {
  isSourcePermitted,
  readSkillSourcesConfig,
} from '../core/source-policy.js'
import { isCliFailure } from '../shared/cli-error.js'
import {
  detectIntentCommandPackageManager,
  formatIntentCommand,
} from '../shared/command-runner.js'
import type { StalenessReport } from '../shared/types.js'

export interface StaleCommandOptions {
  json?: boolean
  githubReview?: boolean
  packageLabel?: string
}

export async function runStaleCommand(
  targetDir: string | undefined,
  options: StaleCommandOptions,
  resolveStaleTargets: (targetDir?: string) => Promise<{
    reports: Array<StalenessReport>
    workflowAdvisories?: Array<string>
  }>,
): Promise<void> {
  if (options.githubReview) {
    await runGithubReview(targetDir, options, resolveStaleTargets)
    return
  }

  const { reports: unfilteredReports, workflowAdvisories = [] } =
    await resolveStaleTargets(targetDir)
  const reports = filterStaleReportSkills(unfilteredReports, targetDir)

  if (options.json) {
    console.log(JSON.stringify(reports, null, 2))
    return
  }

  for (const advisory of workflowAdvisories) {
    console.log(advisory)
  }
  if (workflowAdvisories.length > 0) {
    console.log()
  }

  if (reports.length === 0) {
    console.log('No intent-enabled packages found.')
    return
  }

  for (const report of reports) {
    const driftLabel = report.versionDrift
      ? ` [${report.versionDrift} drift]`
      : ''
    const vLabel =
      report.skillVersion && report.currentVersion
        ? ` (${report.skillVersion} → ${report.currentVersion})`
        : ''
    console.log(`${report.library}${vLabel}${driftLabel}`)

    const stale = report.skills.filter((skill) => skill.needsReview)
    const signals = report.signals.filter((signal) => signal.needsReview)
    if (stale.length === 0 && signals.length === 0) {
      console.log('  All skills up-to-date')
    } else {
      for (const skill of stale) {
        console.log(`  ⚠ ${skill.name}: ${skill.reasons.join(', ')}`)
      }
      for (const signal of signals) {
        const subject =
          signal.packageName ??
          signal.packageRoot ??
          signal.skill ??
          signal.artifactPath ??
          signal.subject ??
          report.library
        console.log(`  ⚠ ${subject}: ${signal.reasons.join(', ')}`)
      }
    }

    console.log()
  }

  if (
    reports.some(
      (report) =>
        report.skills.some((skill) => skill.needsReview) ||
        report.signals.some((signal) => signal.needsReview),
    )
  ) {
    const command = formatIntentCommand(
      detectIntentCommandPackageManager(targetDir),
      'meta generate-skill',
    )
    console.log(
      `Next: ask your coding agent to run \`${command}\` and follow it with this report and the relevant code/docs change.`,
    )
  }
}

async function runGithubReview(
  targetDir: string | undefined,
  options: StaleCommandOptions,
  resolveStaleTargets: (targetDir?: string) => Promise<{
    reports: Array<StalenessReport>
    workflowAdvisories?: Array<string>
  }>,
): Promise<void> {
  const {
    collectStaleReviewItems,
    createFailedStaleReviewItem,
    createWorkflowAdvisoryReviewItems,
    writeStaleReviewWorkflowFiles,
  } = await import('../staleness/workflow-review.js')
  const packageLabel = options.packageLabel ?? 'workspace'

  try {
    const { reports: unfilteredReports, workflowAdvisories = [] } =
      await resolveStaleTargets(targetDir)
    const reports = filterStaleReportSkills(unfilteredReports, targetDir)
    const items = [
      ...collectStaleReviewItems(reports),
      ...createWorkflowAdvisoryReviewItems(packageLabel, workflowAdvisories),
    ]
    writeStaleReviewWorkflowFiles(items)
    if (items.length === 0) {
      console.log('No stale skills or coverage gaps found.')
    } else {
      console.log(`Wrote ${items.length} intent skill review item(s).`)
    }
  } catch (err) {
    const item = createFailedStaleReviewItem(packageLabel)
    writeStaleReviewWorkflowFiles([item])
    const message = isCliFailure(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err)
    console.log(`Intent stale check failed: ${message}`)
    console.log('Wrote a review PR body so maintainers can inspect the logs.')
  }
}

function filterStaleReportSkills(
  reports: Array<StalenessReport>,
  targetDir: string | undefined,
): Array<StalenessReport> {
  const cwd = resolve(process.cwd(), targetDir ?? process.cwd())
  const context = resolveProjectContext({ cwd })
  const fsCache = createIntentFsCache()
  const config = readSkillSourcesConfig(cwd, context, fsCache)
  const excludeMatchers = compileExcludePatterns(
    getEffectiveExcludePatterns({}, context, fsCache),
  )

  return reports.map((report) => ({
    ...report,
    skills: report.skills.filter(
      (skill) =>
        isSourcePermitted(config, report.library, undefined, skill.name) &&
        !isSkillExcluded(report.library, skill.name, excludeMatchers),
    ),
  }))
}
