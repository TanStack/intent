import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { InstallStateEntry, ReadInstallStateResult } from './state.js'

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

function isInside(path: string, parent: string): boolean {
  const value = relative(parent, path)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

function sourceTarget(expected: ExpectedLink): string | null {
  try {
    const packageRoot = realpathSync(expected.packageRoot)
    const sourceDirectory = realpathSync(expected.sourceDirectory)
    return isInside(sourceDirectory, packageRoot) ? sourceDirectory : null
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

function createLink(path: string, target: string): void {
  mkdirSync(dirname(path), { recursive: true })
  if (process.platform === 'win32') {
    symlinkSync(target, path, 'junction')
    return
  }
  symlinkSync(relative(dirname(path), target), path, 'dir')
}

// `rmSync` with recursive+force silently leaves some directory symlinks in place.
// On Windows a directory symlink or junction needs `rmdirSync`, not `unlinkSync`.
function removeLink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    rmdirSync(path)
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function reconcileManagedLinks({
  dryRun,
  expected,
  stateResult,
}: {
  dryRun: boolean
  expected: ReadonlyArray<ExpectedLink>
  stateResult: ReadInstallStateResult
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

  for (const entry of [...expected].sort((left, right) =>
    compareStrings(left.path, right.path),
  )) {
    const target = sourceTarget(entry)
    if (!target) {
      result.conflicts.push(entry.path)
      continue
    }
    const priorEntry = priorByPath.get(entry.path)
    if (!exists(entry.path)) {
      if (!dryRun) createLink(entry.path, target)
      result.created.push(entry.path)
      result.entries.push(stateEntry(entry, target))
      continue
    }
    if (!isLink(entry.path) || !priorEntry) {
      result.conflicts.push(entry.path)
      if (priorEntry) result.entries.push(priorEntry)
      continue
    }
    const current = resolveLinkTarget(entry.path)
    if (current === target) {
      result.unchanged.push(entry.path)
      result.entries.push(stateEntry(entry, target))
      continue
    }
    if (current === priorEntry.linkTarget) {
      if (!dryRun) {
        removeLink(entry.path)
        createLink(entry.path, target)
      }
      result.repaired.push(entry.path)
      result.entries.push(stateEntry(entry, target))
      continue
    }
    result.conflicts.push(entry.path)
    result.entries.push(priorEntry)
  }

  if (stateResult.status === 'found') {
    for (const priorEntry of prior) {
      if (expectedByPath.has(priorEntry.path)) continue
      if (!exists(priorEntry.path)) {
        result.removed.push(priorEntry.path)
        continue
      }
      if (
        isLink(priorEntry.path) &&
        resolveLinkTarget(priorEntry.path) === priorEntry.linkTarget
      ) {
        if (!dryRun) removeLink(priorEntry.path)
        result.removed.push(priorEntry.path)
        continue
      }
      result.conflicts.push(priorEntry.path)
      result.entries.push(priorEntry)
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
