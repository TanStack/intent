// Staleness Layer 2 — git blob SHA drift against the baseline recorded in
// intent.lock (or an explicit override). Pure candidate detection: a source
// touched since baseline is fed back for human/agent impact classification,
// never a hard "stale" verdict on its own — staleness is a signal, not a gate.
import { isAbsolute, relative } from 'node:path'
import { realpathSync } from 'node:fs'
import {
  blobShaAtCommit,
  currentBlobSha,
  nearestReachableTag,
  repoRoot,
  resolveCommit,
} from '../git-adapter.js'
import {
  assertCanonicalPackageRelativePath,
  resolveCanonicalPackagePath,
} from '../skill-path.js'
import type { IntentLockfile, IntentLockfileSource } from './lockfile.js'

export interface BaselineResolution {
  ref: string
  commit: string
}

export type BaselineResolutionOutcome =
  | { ok: true; baseline: BaselineResolution }
  | { ok: false; reason: string }

// Resolution order: explicit --baseline flag, then the lockfile's recorded
// baseline, then the nearest reachable local tag. No implicit HEAD~1 —
// callers who want that must pass --baseline HEAD~1 explicitly.
export function resolveBaseline(
  cwd: string,
  explicitRef: string | undefined,
  lockfile: IntentLockfile | null,
): BaselineResolutionOutcome {
  const candidateRef = explicitRef ?? lockfile?.staleness?.baseline.ref

  if (candidateRef) {
    const commit = resolveCommit(cwd, candidateRef)
    if (!commit.ok) {
      return {
        ok: false,
        reason: `baseline ref "${candidateRef}" could not be resolved: ${commit.reason}`,
      }
    }
    return { ok: true, baseline: { ref: candidateRef, commit: commit.value } }
  }

  const tag = nearestReachableTag(cwd)
  if (!tag.ok) {
    return {
      ok: false,
      reason:
        'no local reachable tag found and no baseline is recorded in intent.lock.',
    }
  }
  const commit = resolveCommit(cwd, tag.value)
  if (!commit.ok) {
    return {
      ok: false,
      reason: `nearest tag "${tag.value}" could not be resolved to a commit: ${commit.reason}`,
    }
  }
  return { ok: true, baseline: { ref: tag.value, commit: commit.value } }
}

export interface BaselineDriftCandidate {
  id: string
  kind: 'npm' | 'workspace'
  path: string
  reason: 'added-since-baseline' | 'changed-since-baseline'
}

export interface BaselineDriftOutcome {
  ok: true
  candidates: Array<BaselineDriftCandidate>
}

export interface BaselineDriftFailure {
  ok: false
  reason: string
}

function isWithinDir(candidate: string, dir: string): boolean {
  const rel = relative(dir, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// Compares each source's tracked skill files (already package-relative in
// the lockfile) against the baseline commit's tree. `packageRoots` maps a
// source identity key (`kind:id`) to its on-disk package root, so
// package-relative lockfile paths can be resolved to repo-relative paths
// git understands.
export function computeBaselineDrift(
  cwd: string,
  baseline: BaselineResolution,
  sources: ReadonlyArray<IntentLockfileSource>,
  packageRoots: ReadonlyMap<string, string>,
  fileFilter?: ReadonlySet<string>,
): BaselineDriftOutcome | BaselineDriftFailure {
  try {
    for (const source of sources) {
      for (const skillPath of source.skills) {
        assertCanonicalPackageRelativePath(skillPath, 'source.skills path')
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  const root = repoRoot(cwd)
  if (!root.ok) {
    return { ok: false, reason: `not a git repository: ${root.reason}` }
  }
  // realpath: git rev-parse --show-toplevel resolves symlinks (e.g. macOS
  // /tmp -> /private/tmp), but packageRoots may carry the unresolved path.
  // realpath the package root only (a directory, always exists) rather than
  // each skill file, since a file removed since baseline may not exist now.
  const realRoot = realpathSync(root.value)

  const candidates: Array<BaselineDriftCandidate> = []

  for (const source of sources) {
    const packageRoot = packageRoots.get(`${source.kind}:${source.id}`)
    if (!packageRoot) continue

    const realPackageRoot = realpathSync(packageRoot)

    for (const skillPath of source.skills) {
      let resolvedSkillPath: string
      try {
        resolvedSkillPath = resolveCanonicalPackagePath(
          realPackageRoot,
          skillPath,
          'source.skills path',
        )
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        }
      }
      try {
        const realSkillPath = realpathSync(resolvedSkillPath)
        if (!isWithinDir(realSkillPath, realPackageRoot)) {
          return {
            ok: false,
            reason: `source.skills path escapes the package root via a symlink: "${skillPath}".`,
          }
        }
      } catch (err) {
        if (
          !(err instanceof Error) ||
          (err as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          return {
            ok: false,
            reason: `failed to resolve source.skills path "${skillPath}": ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
      const repoRelativePath = relative(realRoot, resolvedSkillPath)

      if (fileFilter && !fileFilter.has(repoRelativePath)) continue

      const baselineSha = blobShaAtCommit(
        cwd,
        baseline.commit,
        repoRelativePath,
      )
      if (!baselineSha.ok) {
        return {
          ok: false,
          reason: `failed to read baseline blob for "${repoRelativePath}": ${baselineSha.reason}`,
        }
      }

      const current = currentBlobSha(cwd, repoRelativePath)
      if (!current.ok) {
        return {
          ok: false,
          reason: `failed to read current blob for "${repoRelativePath}": ${current.reason}`,
        }
      }

      if (baselineSha.value === null && current.value !== null) {
        candidates.push({
          id: source.id,
          kind: source.kind,
          path: skillPath,
          reason: 'added-since-baseline',
        })
        continue
      }

      if (
        baselineSha.value !== null &&
        current.value !== null &&
        baselineSha.value !== current.value
      ) {
        candidates.push({
          id: source.id,
          kind: source.kind,
          path: skillPath,
          reason: 'changed-since-baseline',
        })
      }
    }
  }

  return { ok: true, candidates }
}
