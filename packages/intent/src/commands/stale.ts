import type { StalenessReport } from '../types.js'

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

  const { reports, workflowAdvisories = [] } =
    await resolveStaleTargets(targetDir)

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
    writeStaleReviewWorkflowFiles,
  } = await import('../workflow-review.js')
  const packageLabel = options.packageLabel ?? 'workspace'

  try {
    const { reports } = await resolveStaleTargets(targetDir)
    const items = collectStaleReviewItems(reports)
    writeStaleReviewWorkflowFiles(items)
    if (items.length === 0) {
      console.log('No stale skills or coverage gaps found.')
    } else {
      console.log(`Wrote ${items.length} intent skill review item(s).`)
    }
  } catch (err) {
    const item = createFailedStaleReviewItem(packageLabel)
    writeStaleReviewWorkflowFiles([item])
    const message = err instanceof Error ? err.message : String(err)
    console.log(`Intent stale check failed: ${message}`)
    console.log('Wrote a review PR body so maintainers can inspect the logs.')
  }
}
