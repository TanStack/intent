import { isFrozenMode } from '../../shared/mode.js'
import { fail } from '../../shared/cli-error.js'
import {
  computeBaselineDrift,
  resolveBaseline,
} from '../../core/lockfile/baseline-drift.js'
import { computeLockfileState } from './support.js'
import type { BaselineDriftCandidate } from '../../core/lockfile/baseline-drift.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsStaleCommandOptions {
  json?: boolean
  baseline?: string
  files?: Array<string>
  frozen?: boolean
  noFrozen?: boolean
}

interface SkillsStaleLayer01Candidate {
  id: string
  kind: 'npm' | 'workspace'
  layer: 'self-integrity' | 'version'
  from: unknown
  to: unknown
}

interface SkillsStaleReport {
  frozen: boolean
  baselineRef: string | null
  layer01: Array<SkillsStaleLayer01Candidate>
  layer2: Array<BaselineDriftCandidate>
  layer2Skipped: string | null
}

function layer01FromDiffChanged(
  changed: ReturnType<typeof computeLockfileState>['diff']['changed'],
): Array<SkillsStaleLayer01Candidate> {
  const candidates: Array<SkillsStaleLayer01Candidate> = []
  for (const entry of changed) {
    for (const field of entry.fields) {
      if (field.field === 'contentHash') {
        candidates.push({
          id: entry.id,
          kind: entry.kind,
          layer: 'self-integrity',
          from: field.from,
          to: field.to,
        })
      }
      if (field.field === 'version') {
        candidates.push({
          id: entry.id,
          kind: entry.kind,
          layer: 'version',
          from: field.from,
          to: field.to,
        })
      }
    }
  }
  return candidates
}

function printReport(report: SkillsStaleReport): void {
  if (report.layer01.length === 0 && report.layer2.length === 0) {
    console.log('No staleness candidates found.')
  } else {
    for (const candidate of report.layer01) {
      console.log(
        `${candidate.kind}:${candidate.id} — ${candidate.layer} changed (${JSON.stringify(candidate.from)} -> ${JSON.stringify(candidate.to)})`,
      )
    }
    for (const candidate of report.layer2) {
      console.log(
        `${candidate.kind}:${candidate.id} — ${candidate.path} ${candidate.reason} (baseline ${report.baselineRef})`,
      )
    }
  }

  if (report.layer2Skipped) {
    console.log(`Layer 2 (baseline drift) skipped: ${report.layer2Skipped}`)
  }
}

export async function runSkillsStaleCommand(
  options: SkillsStaleCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
): Promise<void> {
  const frozen = isFrozenMode({
    frozen: options.frozen,
    noFrozen: options.noFrozen,
  })

  const { scan, hiddenSourceCount } = await scanPolicedIntents()
  if (frozen && hiddenSourceCount > 0) {
    fail(
      `Frozen mode found ${hiddenSourceCount} unlisted skill-bearing source(s) not in intent.skills. Add them to intent.skills or intent.exclude, then re-run outside frozen mode.`,
      3,
    )
  }
  const state = computeLockfileState(scan, cwd)

  if (state.lockedResult.status !== 'found') {
    if (frozen) {
      fail(
        'Frozen mode requires intent.lock. Run `intent skills approve --all` outside frozen mode first.',
        4,
      )
    }
    console.log(
      'No intent.lock found. Run `intent skills approve --all` to create one.',
    )
    return
  }

  const lockfile = state.lockedResult.lockfile
  const layer01 = layer01FromDiffChanged(state.diff.changed)

  const baselineOutcome = resolveBaseline(cwd, options.baseline, lockfile)

  let layer2: Array<BaselineDriftCandidate> = []
  let layer2Skipped: string | null = null
  let baselineRef: string | null = null

  if (!baselineOutcome.ok) {
    if (frozen) {
      fail(
        `Frozen mode requires a resolvable staleness baseline: ${baselineOutcome.reason}`,
        5,
      )
    }
    layer2Skipped = baselineOutcome.reason
  } else {
    baselineRef = baselineOutcome.baseline.ref
    const packageRoots = new Map(
      scan.packages.map((pkg) => [`${pkg.kind}:${pkg.name}`, pkg.packageRoot]),
    )
    const fileFilter = options.files ? new Set(options.files) : undefined

    const driftOutcome = computeBaselineDrift(
      cwd,
      baselineOutcome.baseline,
      lockfile.sources,
      packageRoots,
      fileFilter,
    )

    if (!driftOutcome.ok) {
      if (frozen) {
        fail(
          `Frozen mode: baseline drift check failed: ${driftOutcome.reason}`,
          5,
        )
      }
      layer2Skipped = driftOutcome.reason
    } else {
      layer2 = driftOutcome.candidates
    }
  }

  const report: SkillsStaleReport = {
    frozen,
    baselineRef,
    layer01,
    layer2,
    layer2Skipped,
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReport(report)
  }

  if (frozen && (layer01.length > 0 || layer2.length > 0)) {
    fail(
      'Frozen mode: staleness candidates found. Refresh and re-approve outside frozen mode before merging.',
      1,
    )
  }
}
