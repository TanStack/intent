import {
  lstatSync,
  mkdirSync,
  existsSync as nativeExistsSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { isPathWithin } from '../../shared/utils.js'
import type { InstallStateEntry, ReadInstallStateResult } from './state.js'
import type { ReadFs } from '../../shared/utils.js'

export interface ExpectedLink {
  path: string
  targetDirectory: string
  alias: string
  source: { kind: 'npm' | 'workspace'; id: string }
  skillPath: string
  sourceDirectory: string
  packageRoot: string
}

export interface LinkReconciliation {
  created: Array<string>
  repaired: Array<string>
  removed: Array<string>
  unchanged: Array<string>
  conflicts: Array<string>
  entries: Array<InstallStateEntry>
}

export function hasNonNativeLinkSource(
  expected: ReadonlyArray<ExpectedLink>,
  readFs: ReadFs,
): boolean {
  return expected.some(
    (entry) =>
      readFs.existsSync(entry.sourceDirectory) &&
      !nativeExistsSync(entry.sourceDirectory),
  )
}

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function resolveLinkTarget(path: string): string | null {
  try {
    const target = readlinkSync(path)
    return resolve(dirname(path), target)
  } catch {
    return null
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function hasContainedParent(path: string, root: string): boolean {
  try {
    const resolvedRoot = resolve(root)
    const resolvedParent = resolve(dirname(path))
    if (!isPathWithin(resolvedRoot, resolvedParent)) return false
    const realRoot = realpathSync(resolvedRoot)
    let existingParent = resolvedParent
    for (;;) {
      try {
        lstatSync(existingParent)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
      }
      const parent = dirname(existingParent)
      if (parent === existingParent) return false
      existingParent = parent
    }
    return isPathWithin(realRoot, realpathSync(existingParent))
  } catch {
    return false
  }
}

function sourceTarget(expected: ExpectedLink): string | null {
  try {
    const packageRoot = realpathSync(expected.packageRoot)
    const sourceDirectory = realpathSync(expected.sourceDirectory)
    return isPathWithin(packageRoot, sourceDirectory) ? sourceDirectory : null
  } catch {
    return null
  }
}

function stateEntry(
  expected: ExpectedLink,
  linkTarget: string,
): InstallStateEntry {
  return {
    targetDirectory: expected.targetDirectory,
    path: expected.path,
    alias: expected.alias,
    source: expected.source,
    skillPath: expected.skillPath,
    linkTarget,
  }
}

function createLink(path: string, target: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    if (process.platform === 'win32') {
      symlinkSync(target, path, 'junction')
    } else {
      symlinkSync(relative(dirname(path), target), path, 'dir')
    }
    return true
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code === 'string') return false
    throw error
  }
}

// `rmSync` with recursive+force silently leaves some directory symlinks in place.
// On Windows a directory symlink or junction needs `rmdirSync`, not `unlinkSync`.
function removeLink(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch (unlinkError) {
    if (process.platform !== 'win32') {
      if (isRemovalConflict(unlinkError)) return false
      throw unlinkError
    }
    try {
      rmdirSync(path)
      return true
    } catch (rmdirError) {
      if (isRemovalConflict(rmdirError)) return false
      throw rmdirError
    }
  }
}

function isRemovalConflict(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM'
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function reconcileManagedLinks({
  root,
  dryRun,
  expected,
  stateResult,
  createLink: createManagedLink = createLink,
  removeLink: removeManagedLink = removeLink,
}: {
  root: string
  dryRun: boolean
  expected: ReadonlyArray<ExpectedLink>
  stateResult: ReadInstallStateResult
  createLink?: (path: string, target: string) => boolean
  removeLink?: (path: string) => boolean
}): LinkReconciliation {
  const result: LinkReconciliation = {
    created: [],
    repaired: [],
    removed: [],
    unchanged: [],
    conflicts: [],
    entries: [],
  }
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]))
  const prior = stateResult.status === 'found' ? stateResult.state.entries : []
  const priorByPath = new Map(prior.map((entry) => [entry.path, entry]))
  const preserveConflict = (
    path: string,
    priorEntry?: InstallStateEntry,
  ): void => {
    result.conflicts.push(path)
    if (priorEntry) result.entries.push(priorEntry)
  }

  for (const entry of [...expected].sort((left, right) =>
    compareStrings(left.path, right.path),
  )) {
    const priorEntry = priorByPath.get(entry.path)
    if (!hasContainedParent(entry.path, root)) {
      preserveConflict(entry.path, priorEntry)
      continue
    }
    const target = sourceTarget(entry)
    if (!target) {
      preserveConflict(entry.path, priorEntry)
      continue
    }
    if (!exists(entry.path)) {
      if (!dryRun && !createManagedLink(entry.path, target)) {
        preserveConflict(entry.path, priorEntry)
        continue
      }
      result.created.push(entry.path)
      result.entries.push(stateEntry(entry, target))
      continue
    }
    if (!isLink(entry.path) || !priorEntry) {
      preserveConflict(entry.path, priorEntry)
      continue
    }
    const current = resolveLinkTarget(entry.path)
    if (current === target) {
      result.unchanged.push(entry.path)
      result.entries.push(stateEntry(entry, target))
      continue
    }
    if (current === priorEntry.linkTarget) {
      if (
        !dryRun &&
        (!removeManagedLink(entry.path) ||
          !createManagedLink(entry.path, target))
      ) {
        preserveConflict(entry.path, priorEntry)
        continue
      }
      result.repaired.push(entry.path)
      result.entries.push(stateEntry(entry, target))
      continue
    }
    preserveConflict(entry.path, priorEntry)
  }

  if (stateResult.status === 'found') {
    for (const priorEntry of prior) {
      if (expectedByPath.has(priorEntry.path)) continue
      if (!hasContainedParent(priorEntry.path, root)) {
        preserveConflict(priorEntry.path, priorEntry)
        continue
      }
      if (!exists(priorEntry.path)) {
        result.removed.push(priorEntry.path)
        continue
      }
      if (
        isLink(priorEntry.path) &&
        resolveLinkTarget(priorEntry.path) === priorEntry.linkTarget
      ) {
        if (!dryRun && !removeManagedLink(priorEntry.path)) {
          preserveConflict(priorEntry.path, priorEntry)
          continue
        }
        result.removed.push(priorEntry.path)
        continue
      }
      preserveConflict(priorEntry.path, priorEntry)
    }
  }

  return {
    created: result.created.sort(compareStrings),
    repaired: result.repaired.sort(compareStrings),
    removed: result.removed.sort(compareStrings),
    unchanged: result.unchanged.sort(compareStrings),
    conflicts: [...new Set(result.conflicts)].sort(compareStrings),
    entries: result.entries.sort((left, right) =>
      compareStrings(left.path, right.path),
    ),
  }
}
