import { dirname, join, resolve } from 'node:path'
import { sourceIdentityKey } from '../../core/types.js'
import { buildInstallDeltaInventory } from '../install/plan.js'
import {
  createSyncAliases,
  resolveSyncTargetDirectories,
  toProjectRelativePath,
} from './targets.js'
import type { IntentConsumerConfig } from '../install/config.js'
import type { InstallTarget } from '../install/delivery.js'
import type { InstallDeltaInventory } from '../install/plan.js'
import type { ExpectedLink } from './links.js'
import type {
  IntentLockfileSource,
  ReadIntentLockfileResult,
} from '../../core/lockfile/lockfile.js'
import type { IntentPackage } from '../../shared/types.js'

function findSkill(pkg: IntentPackage, name: string) {
  return pkg.skills.find((skill) => skill.name === name)
}

export function buildSyncLinkPlan({
  config,
  currentSources,
  discovered,
  lock,
  packages,
  root,
  targets,
}: {
  config: IntentConsumerConfig
  currentSources: ReadonlyArray<IntentLockfileSource>
  discovered: ReadonlyArray<IntentPackage>
  lock: ReadIntentLockfileResult
  packages: ReadonlyArray<IntentPackage>
  root: string
  targets: ReadonlyArray<InstallTarget>
}): {
  expected: Array<ExpectedLink>
  inventory: InstallDeltaInventory
} {
  const inventory = buildInstallDeltaInventory(
    discovered,
    currentSources,
    lock,
    config,
  )
  const aliases = new Map(
    createSyncAliases(
      packages.flatMap((pkg) =>
        pkg.skills.map((skill) => ({
          kind: pkg.kind,
          id: pkg.name,
          skill: skill.name,
        })),
      ),
    ).map((entry) => [
      `${sourceIdentityKey(entry)}\0${entry.skill}`,
      entry.alias,
    ]),
  )
  const sources = new Map(
    discovered.map((pkg) => [
      sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
      pkg,
    ]),
  )
  const accepted = inventory.packages.flatMap((pkg) => {
    const source = sources.get(
      sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
    )
    if (!source) return []
    return pkg.skills.flatMap((skill) => {
      if (skill.policy !== 'enabled' || skill.lock !== 'accepted') return []
      const sourceSkill = findSkill(
        source,
        skill.id.slice(skill.id.indexOf('#') + 1),
      )
      return sourceSkill ? [{ pkg, skill: sourceSkill, source }] : []
    })
  })
  const targetDirectories = resolveSyncTargetDirectories(root, targets)
  const expected = accepted.flatMap(({ pkg, skill, source }) => {
    const identity = `${sourceIdentityKey({ kind: pkg.kind, id: pkg.name })}\0${skill.name}`
    const alias = aliases.get(identity)
    if (!alias) throw new Error(`Missing sync alias for ${identity}.`)
    return targetDirectories.map((target) => ({
      path: join(target.path, alias),
      targetDirectory: toProjectRelativePath(root, target.path),
      alias,
      source: { kind: pkg.kind, id: pkg.name },
      skillPath: `skills/${skill.name}`,
      sourceDirectory: resolve(root, dirname(skill.path)),
      packageRoot: source.packageRoot,
    }))
  })
  return { expected, inventory }
}
