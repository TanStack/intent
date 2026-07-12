import { join } from 'node:path'
import { diffLockfileSources } from '../../core/lockfile/lockfile-diff.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { readIntentLockfile } from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { fail } from '../../shared/cli-error.js'
import { escapeReviewValue } from '../../shared/cli-output.js'
import type { LockfileDiffResult } from '../../core/lockfile/lockfile-diff.js'
import type { SourceContentReview } from '../../core/lockfile/content-review.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../../core/lockfile/lockfile.js'
import type {
  IntentHiddenSourceSummary,
  SourceIdentity,
} from '../../core/types.js'
import type { ScanResult } from '../../shared/types.js'

export function resolveLockfilePath(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? cwd
  return join(root, 'intent.lock')
}

// Shared by `approve` and `update`'s single-source argument form.
export function resolveSourceArg(
  arg: string,
  discovered: ReadonlyArray<SourceIdentity>,
): SourceIdentity {
  const separatorIndex = arg.indexOf(':')

  if (separatorIndex !== -1) {
    const kind = arg.slice(0, separatorIndex)
    let id = arg.slice(separatorIndex + 1)

    // Tolerate diff.ts's displayed kind:id@version label as input, but only
    // strip a trailing @version, not a scoped package's leading @scope.
    const lastAt = id.lastIndexOf('@')
    if (lastAt > 0 && /^\d/.test(id.slice(lastAt + 1))) {
      id = id.slice(0, lastAt)
    }

    if (kind !== 'npm' && kind !== 'workspace') {
      fail(
        `Invalid source "${arg}". Expected the form kind:id, e.g. npm:@tanstack/query or workspace:my-package.`,
      )
    }

    return { kind, id }
  }

  // Bare name (F1 rule): resolve against currently-discovered sources. A name
  // shared across kinds (e.g. workspace:foo and npm:foo) can't be guessed.
  const matches = discovered.filter((source) => source.id === arg)
  const [firstMatch] = matches

  if (!firstMatch) {
    fail(
      `No discovered source matches "${arg}". It may not be installed, or may not be listed in intent.skills.`,
    )
  }

  if (matches.length > 1) {
    const labels = matches
      .map((source) => `${source.kind}:${source.id}`)
      .sort()
      .join(' and ')
    fail(`Ambiguous source "${arg}": matches ${labels} — specify kind:id.`)
  }

  return firstMatch
}

export interface LockfileState {
  current: Array<IntentLockfileSource>
  lockedResult: ReadIntentLockfileResult
  diff: LockfileDiffResult
}

export function computeLockfileState(
  scan: ScanResult,
  cwd: string,
): LockfileState {
  const current = buildCurrentLockfileSources(scan.packages, scan.readFs)
  const lockedResult = readLockfileOrFail(cwd)
  const diff = diffLockfileSources(current, lockedResult)
  return { current, lockedResult, diff }
}

function readLockfileOrFail(cwd: string): ReadIntentLockfileResult {
  try {
    return readIntentLockfile(resolveLockfilePath(cwd))
  } catch (err) {
    fail(
      `Malformed intent.lock: ${err instanceof Error ? err.message : String(err)}`,
      6,
    )
  }
}

export function buildSkillsDiff(
  scan: ScanResult,
  cwd: string,
): LockfileDiffResult {
  return computeLockfileState(scan, cwd).diff
}

export function formatHiddenSourceDetails(
  hiddenSources: ReadonlyArray<IntentHiddenSourceSummary>,
): string {
  if (hiddenSources.length === 0) return ''

  const details = hiddenSources
    .toSorted((a, b) =>
      `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`),
    )
    .map((source) => {
      const provenance = source.provenance
        ?.map((path) => path.map(escapeReviewValue).join(' -> '))
        .join('; ')
      const label = `${source.kind}:${escapeReviewValue(source.name)}`
      return provenance
        ? `${label} (via ${provenance})`
        : `${label} (provenance unknown)`
    })
    .join(', ')

  return `: ${details}`
}

function formatCanonicalText(content: Buffer): string {
  return content
    .toString('utf8')
    .split('\n')
    .map((line, index) => {
      const escaped = escapeReviewValue(line)
      return `    ${String(index + 1).padStart(4)} | ${escaped}`
    })
    .join('\n')
}

export function printSourceContentReviews(
  reviews: ReadonlyArray<SourceContentReview>,
): void {
  for (const review of reviews) {
    console.log(
      `Reviewing ${review.kind}:${escapeReviewValue(review.id)}@${escapeReviewValue(review.version)}`,
    )
    if (review.files.length === 0) {
      console.log('  No skill content files.')
      console.log()
      continue
    }

    for (const file of review.files) {
      if (file.isBinary) {
        console.log(
          `  Binary: ${escapeReviewValue(file.relativePath)} (${file.byteLength} bytes, ${file.contentHash})`,
        )
        continue
      }

      console.log(
        `  Text: ${escapeReviewValue(file.relativePath)} (canonical UTF-8, ${file.content.length} bytes)`,
      )
      console.log(formatCanonicalText(file.content))
    }
    console.log()
  }
}

export function enforceFrozenMode(
  diff: LockfileDiffResult,
  frozen: boolean,
  hiddenSourceCount: number,
  hiddenSources: ReadonlyArray<IntentHiddenSourceSummary> = [],
): void {
  if (!frozen) return

  if (hiddenSourceCount > 0) {
    fail(
      `Frozen mode found ${hiddenSourceCount} unlisted skill-bearing source(s) not in intent.skills${formatHiddenSourceDetails(hiddenSources)}. Add them to intent.skills or intent.exclude, then re-run outside frozen mode.`,
      3,
    )
  }

  if (!diff.hasLockfile) {
    fail(
      'Frozen mode requires intent.lock. Run `intent skills approve --all` outside frozen mode first.',
      4,
    )
  }
  if (!diff.isClean) {
    fail(
      'intent.lock is out of date. Run `intent skills diff` outside frozen mode, then `intent skills approve`.',
      2,
    )
  }
}
