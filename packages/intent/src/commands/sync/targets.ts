import { createHash } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'
import type { InstallTarget } from '../install/config.js'

export interface SyncTargetDirectory {
  id: InstallTarget
  path: string
}

const TARGETS: Readonly<Record<InstallTarget, string>> = {
  agents: '.agents/skills',
  github: '.github/skills',
  vscode: '.github/skills',
  cursor: '.cursor/skills',
  codex: '.codex/skills',
  claude: '.claude/skills',
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function toProjectRelativePath(root: string, path: string): string {
  return relative(resolve(root), resolve(path)).split(sep).join('/')
}

export function resolveSyncTargetDirectories(
  root: string,
  targets: ReadonlyArray<InstallTarget>,
): Array<SyncTargetDirectory> {
  const unique = new Map<string, SyncTargetDirectory>()
  for (const id of targets) {
    const path = join(root, TARGETS[id])
    const relativePath = toProjectRelativePath(root, path)
    if (!unique.has(relativePath)) unique.set(relativePath, { id, path })
  }
  return [...unique.values()].sort((left, right) =>
    compareStrings(
      toProjectRelativePath(root, left.path),
      toProjectRelativePath(root, right.path),
    ),
  )
}

function sanitize(value: string): string {
  return value
    .replace(/^@/, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface SyncAliasInput {
  kind: 'npm' | 'workspace'
  id: string
  skill: string
}

export interface SyncAlias extends SyncAliasInput {
  alias: string
}

export function createSyncAliases(
  inputs: ReadonlyArray<SyncAliasInput>,
): Array<SyncAlias> {
  const preliminary = inputs.map((input) => ({
    ...input,
    alias: `${input.kind}-${sanitize(input.id)}-${sanitize(input.skill)}`,
  }))
  const counts = new Map<string, number>()
  for (const entry of preliminary) {
    counts.set(entry.alias, (counts.get(entry.alias) ?? 0) + 1)
  }
  return preliminary
    .map((entry) => {
      if (counts.get(entry.alias) === 1) return entry
      const identity = `${entry.kind}:${entry.id}#${entry.skill}`
      const suffix = createHash('sha256')
        .update(identity)
        .digest('hex')
        .slice(0, 8)
      return { ...entry, alias: `${entry.alias}-${suffix}` }
    })
    .sort((left, right) => {
      const leftIdentity = `${left.kind}\0${left.id}\0${left.skill}`
      const rightIdentity = `${right.kind}\0${right.id}\0${right.skill}`
      return compareStrings(leftIdentity, rightIdentity)
    })
}
