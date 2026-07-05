import { join } from 'node:path'
import { diffLockfileSources } from '../../core/lockfile/lockfile-diff.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { readIntentLockfile } from '../../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { fail } from '../../shared/cli-error.js'
import type { LockfileDiffResult } from '../../core/lockfile/lockfile-diff.js'
import type { ScanResult } from '../../shared/types.js'

export function resolveLockfilePath(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? cwd
  return join(root, 'intent.lock')
}

export function buildSkillsDiff(
  scan: ScanResult,
  cwd: string,
): LockfileDiffResult {
  const current = buildCurrentLockfileSources(scan.packages)
  const lockedResult = readIntentLockfile(resolveLockfilePath(cwd))
  return diffLockfileSources(current, lockedResult)
}

// Frozen mode never mutates intent.lock — a missing or stale lockfile is a
// hard failure so CI can't silently drift from what was approved.
export function enforceFrozenMode(
  diff: LockfileDiffResult,
  frozen: boolean,
): void {
  if (!frozen) return

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
