import { join } from 'node:path'
import { diffLockfileSources } from '../../core/lockfile/lockfile-diff.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { readIntentLockfile } from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { fail } from '../../shared/cli-error.js'
import type { LockfileDiffResult } from '../../core/lockfile/lockfile-diff.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../../core/lockfile/lockfile.js'
import type { SourceIdentity } from '../../core/types.js'
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
  const current = buildCurrentLockfileSources(scan.packages)
  const lockedResult = readIntentLockfile(resolveLockfilePath(cwd))
  const diff = diffLockfileSources(current, lockedResult)
  return { current, lockedResult, diff }
}

export function buildSkillsDiff(
  scan: ScanResult,
  cwd: string,
): LockfileDiffResult {
  return computeLockfileState(scan, cwd).diff
}

export function enforceFrozenMode(
  diff: LockfileDiffResult,
  frozen: boolean,
  hiddenSourceCount: number,
): void {
  if (!frozen) return

  if (hiddenSourceCount > 0) {
    fail(
      `Frozen mode found ${hiddenSourceCount} unlisted skill-bearing source(s) not in intent.skills. Add them to intent.skills or intent.exclude, then re-run outside frozen mode.`,
    )
  }

  if (!diff.hasLockfile) {
    fail(
      'Frozen mode requires intent.lock. Run `intent skills scan` outside frozen mode first.',
    )
  }
  if (!diff.isClean) {
    fail(
      'intent.lock is out of date. Run `intent skills diff` outside frozen mode, then `intent skills approve`.',
    )
  }
}
