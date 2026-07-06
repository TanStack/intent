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
import type { ScanResult } from '../../shared/types.js'

export function resolveLockfilePath(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? cwd
  return join(root, 'intent.lock')
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
