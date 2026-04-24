import { appendFileSync, writeFileSync } from 'node:fs'
import type { StalenessReport } from './types.js'

export interface StaleReviewItem {
  type: string
  library: string
  subject: string
  reasons: Array<string>
  artifactPath?: string
  packageName?: string
  packageRoot?: string
  skill?: string
}

export function collectStaleReviewItems(
  reports: Array<StalenessReport>,
): Array<StaleReviewItem> {
  const items: Array<StaleReviewItem> = []

  for (const report of reports) {
    for (const skill of report.skills ?? []) {
      if (!skill?.needsReview) continue
      items.push({
        type: 'stale-skill',
        library: report.library,
        subject: skill.name,
        reasons: skill.reasons ?? [],
      })
    }

    for (const signal of report.signals ?? []) {
      if (signal?.needsReview === false) continue
      items.push({
        type: signal?.type ?? 'review-signal',
        library: signal?.library ?? report.library,
        subject:
          signal?.packageName ??
          signal?.packageRoot ??
          signal?.skill ??
          signal?.artifactPath ??
          signal?.subject ??
          report.library,
        reasons: signal?.reasons ?? [],
        artifactPath: signal?.artifactPath,
        packageName: signal?.packageName,
        packageRoot: signal?.packageRoot,
        skill: signal?.skill,
      })
    }
  }

  return items
}

export function createFailedStaleReviewItem(library: string): StaleReviewItem {
  return {
    type: 'stale-check-failed',
    library,
    subject: 'intent stale --json',
    reasons: [
      'The stale check command failed. Review the workflow logs before updating skills.',
    ],
  }
}

export function buildStaleReviewBody(items: Array<StaleReviewItem>): string {
  const grouped = new Map<string, number>()

  for (const item of items) {
    grouped.set(item.type, (grouped.get(item.type) ?? 0) + 1)
  }

  const signalRows = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `| \`${type}\` | ${count} |`)

  const itemRows = items.map((item) => {
    const subject = item.subject ? `\`${item.subject}\`` : '-'
    const reasons = item.reasons?.length ? item.reasons.join('; ') : '-'
    return `| \`${item.type}\` | ${subject} | \`${item.library}\` | ${reasons} |`
  })

  const reasonBullets = items.map((item) => {
    const subject = item.subject ? `\`${item.subject}\`` : '`unknown`'
    const reasons = item.reasons?.length
      ? item.reasons.join('; ')
      : 'Intent did not emit a detailed reason for this signal.'
    return `- \`${item.type}\` for ${subject}: ${reasons}`
  })

  const prompt = [
    'You are helping maintain Intent skills for this repository.',
    '',
    'Goal:',
    'Resolve the Intent skill review signals below while preserving the existing scope, taxonomy, and maintainer-reviewed artifacts.',
    '',
    'Review signals:',
    JSON.stringify(items, null, 2),
    '',
    'Required workflow:',
    '1. Read the existing `_artifacts/*domain_map.yaml`, `_artifacts/*skill_tree.yaml`, and generated `skills/**/SKILL.md` files.',
    '2. Read each flagged package package.json, public exports, README/docs if present, and source entry points.',
    '3. Compare flagged packages against the existing domains, skills, tasks, packages, covers, sources, tensions, and cross-references in the artifacts.',
    '4. For each signal, decide whether it means existing skill coverage, a missing generated skill, a new skill candidate, out-of-scope coverage, or deferred work.',
    '',
    'Maintainer questions:',
    'Before editing skills or artifacts, ask the maintainer:',
    '1. For each flagged package, is this package user-facing enough to need agent guidance?',
    '2. If yes, should it extend an existing skill or become a new skill?',
    '3. If it extends an existing skill, which current skill should own it?',
    '4. If it is out of scope, what short reason should be recorded in artifact coverage ignores?',
    '5. Are any of these packages experimental or unstable enough to exclude for now?',
    '',
    'Decision rules:',
    '- Do not auto-generate skills.',
    '- Do not create broad new skill areas without maintainer confirmation.',
    '- Prefer adding package coverage to an existing skill when the package is an implementation variant of an existing domain.',
    '- Create a new skill only when the package introduces a distinct developer task or failure mode.',
    '- Preserve current naming, path, and package layout conventions.',
    '- Keep generated skills under the package-local `skills/` directory.',
    '- Keep repo-root `_artifacts` as the reviewed plan.',
    '',
    'If maintainer confirms updates:',
    '1. Update the relevant `_artifacts/*domain_map.yaml` or `_artifacts/*skill_tree.yaml`.',
    '2. Update or create `SKILL.md` files only for confirmed coverage changes.',
    '3. Keep `sources` aligned between artifact skill entries and SKILL frontmatter.',
    '4. Bump `library_version` only for skills whose covered source package version changed.',
    '5. Run `npx @tanstack/intent@latest validate` on touched skill directories.',
    '6. Summarize every package as one of: existing-skill coverage, new skill, ignored, or deferred.',
  ].join('\n')

  return [
    '## Intent Skill Review Needed',
    '',
    'Intent found skills, artifact coverage, or workspace package coverage that need maintainer review.',
    '',
    '### Summary',
    '',
    '| Signal | Count |',
    '| --- | ---: |',
    ...signalRows,
    '',
    '### Why This PR Opened',
    '',
    ...reasonBullets,
    '',
    '### Review Items',
    '',
    '| Signal | Subject | Library | Reason |',
    '| --- | --- | --- | --- |',
    ...itemRows,
    '',
    '### Agent Prompt',
    '',
    'Paste this into your coding agent:',
    '',
    '```text',
    prompt,
    '```',
    '',
    'This PR is a review reminder only. It does not update skills automatically.',
  ].join('\n')
}

export interface WriteStaleReviewWorkflowFilesOptions {
  outputPath?: string
  summaryPath?: string
  reviewItemsPath?: string
  prBodyPath?: string
}

export function writeStaleReviewWorkflowFiles(
  items: Array<StaleReviewItem>,
  options: WriteStaleReviewWorkflowFilesOptions = {},
): void {
  const outputPath = options.outputPath ?? process.env.GITHUB_OUTPUT
  const summaryPath = options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY
  const reviewItemsPath = options.reviewItemsPath ?? 'review-items.json'
  const prBodyPath = options.prBodyPath ?? 'pr-body.md'
  const hasReview = items.length > 0

  writeFileSync(reviewItemsPath, JSON.stringify(items, null, 2) + '\n')

  if (outputPath) {
    appendFileSync(outputPath, `has_review=${hasReview ? 'true' : 'false'}\n`)
  }

  const summary = hasReview
    ? buildStaleReviewBody(items) + '\n'
    : [
        '### Intent skill review',
        '',
        'No stale skills or coverage gaps found.',
        '',
      ].join('\n')

  if (hasReview) {
    writeFileSync(prBodyPath, summary)
  }

  if (summaryPath) {
    appendFileSync(summaryPath, summary)
  }
}
