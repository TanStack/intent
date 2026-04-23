import type { StalenessReport } from '../types.js'

export async function runStaleCommand(
  targetDir: string | undefined,
  options: { json?: boolean },
  resolveStaleTargets: (targetDir?: string) => Promise<{
    reports: Array<StalenessReport>
    workflowAdvisories?: Array<string>
  }>,
): Promise<void> {
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
          signal.subject ??
          signal.packageName ??
          signal.packageRoot ??
          signal.skill ??
          signal.artifactPath ??
          signal.type
        console.log(`  ⚠ ${subject}: ${signal.reasons.join(', ')}`)
      }
    }

    console.log()
  }
}
