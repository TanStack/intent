import {
  compileExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
} from '../../core/excludes.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { compileSkillSourcePolicy } from '../../core/source-policy.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../../core/lockfile/lockfile.js'
import type { ExcludeMatcher } from '../../core/excludes.js'
import type { SkillSourcesConfig } from '../../core/skill-sources.js'
import type { CompiledSkillSourcePolicy } from '../../core/source-policy.js'
import type { IntentConsumerConfig } from './config.js'
import type { IntentPackage, SkillEntry } from '../../shared/types.js'

export type SkillSelection =
  | { mode: 'all-found' }
  | { mode: 'scope'; scope: string }
  | { mode: 'individual'; enabled: Array<string> }
  | {
      mode: 'configured-policy'
      skills: Array<string>
      exclude: Array<string>
    }

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

export interface InstallDeltaSummary {
  newDependencies: Array<{ name: string; skillCount: number }>
  newSkills: Array<{ name: string; skillCount: number }>
  changed: Array<{ name: string; skillCount: number }>
  removed: number
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sourceEntry(pkg: Pick<IntentPackage, 'kind' | 'name'>): string {
  return pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name
}

export function summarizeInstallDeltaInventory(
  inventory: InstallDeltaInventory,
): InstallDeltaSummary {
  return {
    newDependencies: inventory.packages
      .map((pkg) => ({
        name: sourceEntry(pkg),
        skillCount: pkg.skills.filter((skill) => skill.policy === 'pending')
          .length,
      }))
      .filter((entry) => entry.skillCount > 0),
    newSkills: inventory.packages
      .map((pkg) => ({
        name: sourceEntry(pkg),
        skillCount: pkg.skills.filter(
          (skill) => skill.policy === 'enabled' && skill.lock === 'new',
        ).length,
      }))
      .filter((entry) => entry.skillCount > 0),
    changed: inventory.packages
      .map((pkg) => ({
        name: sourceEntry(pkg),
        skillCount: pkg.skills.filter(
          (skill) => skill.policy === 'enabled' && skill.lock === 'changed',
        ).length,
      }))
      .filter((entry) => entry.skillCount > 0),
    removed: inventory.removed.length,
  }
}

export function skillSelectionId(
  pkg: IntentPackage,
  skill: SkillEntry,
): string {
  return `${sourceEntry(pkg)}#${skill.name}`
}

function classifySkillPolicy(
  pkg: Pick<IntentPackage, 'kind' | 'name'>,
  skillName: string,
  packageSkills: ReadonlyArray<SkillEntry>,
  sources: SkillSourcesConfig,
  sourcePolicy: CompiledSkillSourcePolicy,
  excludes: Array<ExcludeMatcher>,
): InventoryPolicyStatus {
  if (
    isPackageExcluded(pkg.name, excludes) ||
    isSkillExcluded(pkg.name, skillName, excludes) ||
    sources.mode === 'empty'
  ) {
    return 'excluded'
  }
  return sourcePolicy.permitsSkill(pkg.name, skillName, pkg.kind, packageSkills)
    ? 'enabled'
    : 'pending'
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

function assertExclusionsRepresentable(
  packages: ReadonlyArray<IntentPackage>,
  grouped: ReadonlyArray<{
    skills: ReadonlyArray<{ status: 'enabled' | 'excluded' }>
  }>,
  exclude: ReadonlySet<string>,
): void {
  if (exclude.size === 0) return
  const patterns = [...exclude].map((pattern) => ({
    pattern,
    matchers: compileExcludePatterns([pattern.trim()]),
  }))

  for (const [index, pkg] of packages.entries()) {
    const packageSkills = sortedSkills(pkg)
    for (const [skillIndex, entry] of grouped[index]!.skills.entries()) {
      if (entry.status !== 'enabled') continue
      const skillName = packageSkills[skillIndex]!.name
      const offending = patterns.find(
        ({ matchers }) =>
          isPackageExcluded(pkg.name, matchers) ||
          isSkillExcluded(pkg.name, skillName, matchers),
      )
      if (offending) {
        throw new Error(
          `Cannot write intent.exclude "${offending.pattern}": it would also hide "${sourceEntry(pkg)}#${skillName}", which this selection enables.`,
        )
      }
    }
  }
}

export function buildSkillSelectionPlan(
  discovered: ReadonlyArray<IntentPackage>,
  selection: SkillSelection,
): SkillSelectionPlan {
  const packages = sortedPackages(discovered)
  assertUniqueDiscovery(packages)
  if (selection.mode === 'configured-policy') {
    const sources = parseSkillSources(selection.skills)
    const sourcePolicy = compileSkillSourcePolicy(sources)
    const excludeMatchers = compileExcludePatterns(selection.exclude)
    return {
      skills: selection.skills,
      exclude: selection.exclude,
      packages: packages.map((pkg) => {
        const packageSkills = sortedSkills(pkg)
        return {
          name: pkg.name,
          kind: pkg.kind,
          skills: packageSkills.map((skill) => {
            const id = skillSelectionId(pkg, skill)
            const status = classifySkillPolicy(
              pkg,
              skill.name,
              packageSkills,
              sources,
              sourcePolicy,
              excludeMatchers,
            )
            if (status === 'pending') {
              throw new Error(
                `Configured policy leaves "${id}" pending. Add it to intent.skills or intent.exclude before non-interactive install.`,
              )
            }
            return { id, status }
          }),
        }
      }),
    }
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
    const packageSkills = sortedSkills(pkg)
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
        packageSkills.some((skill) =>
          selected.has(skillSelectionId(pkg, skill)),
        ))
    if (selection.mode === 'scope') {
      skills.add(selection.scope)
    } else if (selection.mode === 'all-found') {
      skills.add(sourceEntry(pkg))
    }

    const entries = packageSkills.map((skill) => {
      const id = skillSelectionId(pkg, skill)
      const enabled = selection.mode !== 'individual' || selected.has(id)
      return {
        id,
        status: enabled ? ('enabled' as const) : ('excluded' as const),
      }
    })
    if (selection.mode === 'scope' && !packageMatchesScope) {
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
      exclude.add(pkg.name)
    } else if (selection.mode === 'individual') {
      const enabledEntries = entries.filter(
        (entry) => entry.status === 'enabled',
      )
      if (enabledEntries.length === entries.length) {
        skills.add(sourceEntry(pkg))
      } else {
        for (const entry of enabledEntries) skills.add(entry.id)
      }
    }
    return { name: pkg.name, kind: pkg.kind, skills: entries }
  })

  assertExclusionsRepresentable(packages, grouped, exclude)

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
  const sourcePolicy = compileSkillSourcePolicy(sources)
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
    const packageSkills = sortedSkills(pkg)
    return {
      name: pkg.name,
      kind: pkg.kind,
      skills: packageSkills.map((skill) => {
        const policy = classifySkillPolicy(
          pkg,
          skill.name,
          packageSkills,
          sources,
          sourcePolicy,
          excludes,
        )
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
