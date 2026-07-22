import {
  compileExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
} from '../../core/excludes.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { isSourcePermitted } from '../../core/source-policy.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../../core/lockfile/lockfile.js'
import type { IntentConsumerConfig } from './config.js'
import type { IntentPackage, SkillEntry } from '../../shared/types.js'

export type SkillSelection =
  | { mode: 'all-found' }
  | { mode: 'scope'; scope: string }
  | { mode: 'individual'; enabled: Array<string> }

export interface SkillSelectionPlan {
  skills: Array<string>
  exclude: Array<string>
  packages: Array<{
    name: string
    kind: IntentPackage['kind']
    skills: Array<{ id: string; status: 'enabled' | 'excluded' }>
  }>
}

export type InventoryPolicyStatus = 'enabled' | 'excluded' | 'pending'
export type InventoryLockStatus = 'accepted' | 'new' | 'changed' | null

export interface InstallDeltaInventory {
  packages: Array<{
    name: string
    kind: IntentPackage['kind']
    skills: Array<{
      id: string
      policy: InventoryPolicyStatus
      lock: InventoryLockStatus
    }>
  }>
  removed: Array<{
    kind: IntentPackage['kind']
    id: string
    path: string | null
  }>
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sourceEntry(pkg: IntentPackage): string {
  return pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name
}

export function skillSelectionId(
  pkg: IntentPackage,
  skill: SkillEntry,
): string {
  return `${sourceEntry(pkg)}#${skill.name}`
}

function skillExclude(pkg: IntentPackage, skill: SkillEntry): string {
  return `${pkg.name}#${skill.name}`
}

function sortedPackages(
  packages: ReadonlyArray<IntentPackage>,
): Array<IntentPackage> {
  return [...packages].sort((left, right) => {
    const byName = compareStrings(left.name, right.name)
    return byName === 0 ? compareStrings(left.kind, right.kind) : byName
  })
}

function sortedSkills(pkg: IntentPackage): Array<SkillEntry> {
  return [...pkg.skills].sort((left, right) =>
    compareStrings(left.name, right.name),
  )
}

function assertUniqueDiscovery(packages: ReadonlyArray<IntentPackage>): void {
  const sources = new Set<string>()
  for (const pkg of packages) {
    const source = `${pkg.kind}\0${pkg.name}`
    if (sources.has(source)) {
      throw new Error(`Duplicate discovered source "${sourceEntry(pkg)}".`)
    }
    sources.add(source)
    const skills = new Set<string>()
    for (const skill of pkg.skills) {
      if (skills.has(skill.name)) {
        throw new Error(
          `Duplicate discovered skill "${skillSelectionId(pkg, skill)}".`,
        )
      }
      skills.add(skill.name)
    }
  }
}

function validateScope(scope: string): void {
  if (!/^@[a-z0-9][a-z0-9._-]*\/\*$/.test(scope)) {
    throw new Error(
      'Scope selection must be an npm scope pattern such as "@tanstack/*".',
    )
  }
}

export function buildSkillSelectionPlan(
  discovered: ReadonlyArray<IntentPackage>,
  selection: SkillSelection,
): SkillSelectionPlan {
  const packages = sortedPackages(discovered)
  assertUniqueDiscovery(packages)
  const kindsByName = new Map<string, Set<IntentPackage['kind']>>()
  for (const pkg of packages) {
    const kinds = kindsByName.get(pkg.name) ?? new Set()
    kinds.add(pkg.kind)
    kindsByName.set(pkg.name, kinds)
  }
  const selected = new Set<string>()
  if (selection.mode === 'scope') validateScope(selection.scope)
  if (selection.mode === 'individual') {
    for (const id of selection.enabled) {
      if (selected.has(id)) throw new Error(`Duplicate selected skill "${id}".`)
      selected.add(id)
    }
    const discoveredIds = new Set(
      packages.flatMap((pkg) =>
        sortedSkills(pkg).map((skill) => skillSelectionId(pkg, skill)),
      ),
    )
    for (const id of selected) {
      if (!/^[^#\s]+#[^#\s]+$/.test(id) || !discoveredIds.has(id)) {
        throw new Error(`Unknown selected skill "${id}".`)
      }
    }
  }

  const skills = new Set<string>()
  const exclude = new Set<string>()
  const grouped = packages.map((pkg) => {
    const packageMatchesScope =
      selection.mode === 'scope' &&
      pkg.kind === 'npm' &&
      new RegExp(
        `^${selection.scope.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ).test(pkg.name)
    const packageEnabled =
      selection.mode === 'all-found' ||
      packageMatchesScope ||
      (selection.mode === 'individual' &&
        sortedSkills(pkg).some((skill) =>
          selected.has(skillSelectionId(pkg, skill)),
        ))
    if (selection.mode === 'scope') {
      skills.add(selection.scope)
    } else if (packageEnabled) {
      skills.add(sourceEntry(pkg))
    }

    const packageSkills = sortedSkills(pkg)
    const entries = packageSkills.map((skill) => {
      const id = skillSelectionId(pkg, skill)
      const enabled = selection.mode !== 'individual' || selected.has(id)
      return {
        id,
        status: enabled ? ('enabled' as const) : ('excluded' as const),
      }
    })
    if (selection.mode === 'scope' && !packageMatchesScope) {
      if ((kindsByName.get(pkg.name)?.size ?? 0) > 1) {
        throw new Error(
          `Cannot exclude only ${sourceEntry(pkg)} because intent.exclude matches npm and workspace sources by package name.`,
        )
      }
      exclude.add(pkg.name)
      return {
        name: pkg.name,
        kind: pkg.kind,
        skills: entries.map((entry) => ({
          ...entry,
          status: 'excluded' as const,
        })),
      }
    }
    if (selection.mode === 'individual' && !packageEnabled) {
      if ((kindsByName.get(pkg.name)?.size ?? 0) > 1) {
        throw new Error(
          `Cannot exclude only ${sourceEntry(pkg)} because intent.exclude matches npm and workspace sources by package name.`,
        )
      }
      exclude.add(pkg.name)
    } else if (selection.mode === 'individual') {
      for (const [index, entry] of entries.entries()) {
        if (entry.status === 'excluded') {
          if ((kindsByName.get(pkg.name)?.size ?? 0) > 1) {
            throw new Error(
              `Cannot exclude a skill from only ${sourceEntry(pkg)} because intent.exclude matches npm and workspace sources by package name.`,
            )
          }
          exclude.add(skillExclude(pkg, packageSkills[index]!))
        }
      }
    }
    return { name: pkg.name, kind: pkg.kind, skills: entries }
  })

  return {
    skills: [...skills].sort(compareStrings),
    exclude: [...exclude].sort(compareStrings),
    packages: grouped,
  }
}

function sourceKey(source: Pick<IntentLockfileSource, 'kind' | 'id'>): string {
  return `${source.kind}\0${source.id}`
}

function currentSkill(
  skill: SkillEntry,
  current: IntentLockfileSource | undefined,
): IntentLockfileSource['skills'][number] | undefined {
  return current?.skills.find((entry) => entry.path === `skills/${skill.name}`)
}

export function buildInstallDeltaInventory(
  discovered: ReadonlyArray<IntentPackage>,
  currentSources: ReadonlyArray<IntentLockfileSource>,
  lockResult: ReadIntentLockfileResult,
  config: IntentConsumerConfig,
): InstallDeltaInventory {
  assertUniqueDiscovery(discovered)
  const sources = parseSkillSources(config.skills)
  const excludes = compileExcludePatterns(config.exclude)
  const currentByKey = new Map(
    currentSources.map((source) => [sourceKey(source), source]),
  )
  const lockedByKey = new Map(
    lockResult.status === 'found'
      ? lockResult.lockfile.sources.map((source) => [sourceKey(source), source])
      : [],
  )
  const seen = new Set<string>()
  const packages = sortedPackages(discovered).map((pkg) => {
    const key = sourceKey({ kind: pkg.kind, id: pkg.name })
    seen.add(key)
    const current = currentByKey.get(key)
    const locked = lockedByKey.get(key)
    const sourcePermitted = isSourcePermitted(sources, pkg.name, pkg.kind)
    return {
      name: pkg.name,
      kind: pkg.kind,
      skills: sortedSkills(pkg).map((skill) => {
        const excluded =
          isPackageExcluded(pkg.name, excludes) ||
          isSkillExcluded(pkg.name, skill.name, excludes)
        const policy: InventoryPolicyStatus = excluded
          ? 'excluded'
          : sourcePermitted
            ? 'enabled'
            : 'pending'
        if (policy !== 'enabled')
          return { id: skillSelectionId(pkg, skill), policy, lock: null }
        const currentEntry = currentSkill(skill, current)
        const lockedEntry = currentEntry
          ? locked?.skills.find((entry) => entry.path === currentEntry.path)
          : undefined
        const lock: InventoryLockStatus =
          lockedEntry === undefined || currentEntry === undefined
            ? 'new'
            : lockedEntry.contentHash === currentEntry.contentHash
              ? 'accepted'
              : 'changed'
        return {
          id: skillSelectionId(pkg, skill),
          policy,
          lock,
        }
      }),
    }
  })
  const removed: Array<{
    kind: IntentPackage['kind']
    id: string
    path: string | null
  }> = []
  if (lockResult.status === 'found') {
    for (const source of lockResult.lockfile.sources) {
      const current = currentByKey.get(sourceKey(source))
      if (!seen.has(sourceKey(source)) || !current) {
        removed.push({ kind: source.kind, id: source.id, path: null })
        continue
      }
      for (const skill of source.skills) {
        if (!current.skills.some((entry) => entry.path === skill.path)) {
          removed.push({ kind: source.kind, id: source.id, path: skill.path })
        }
      }
    }
  }
  return {
    packages,
    removed: removed.sort((left, right) => {
      const bySource = compareStrings(
        `${left.kind}\0${left.id}`,
        `${right.kind}\0${right.id}`,
      )
      return bySource === 0
        ? compareStrings(left.path ?? '', right.path ?? '')
        : bySource
    }),
  }
}
