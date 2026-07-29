import { bench, describe } from 'vitest'
import { buildInstallDeltaInventory } from '../../packages/intent/src/commands/install/plan.js'
import { createSyncAliases } from '../../packages/intent/src/commands/sync/targets.js'
import { createRepresentativeIntentPackages } from './helpers.js'
import type { IntentLockfileSource } from '../../packages/intent/src/core/lockfile/lockfile.js'
import type { IntentConsumerConfig } from '../../packages/intent/src/commands/install/config.js'

const packages = createRepresentativeIntentPackages()

const sources: Array<IntentLockfileSource> = packages.map((pkg) => ({
  kind: pkg.kind,
  id: pkg.name,
  skills: pkg.skills.map((skill) => ({
    path: `skills/${skill.name}`,
    contentHash: `${pkg.name}-${skill.name}`,
  })),
}))

const config: IntentConsumerConfig = {
  skills: ['@bench/*'],
  exclude: [],
  install: { method: 'symlink', targets: ['agents'] },
}

describe('sync planning', () => {
  bench('plans unchanged representative sources and aliases', () => {
    buildInstallDeltaInventory(
      packages,
      sources,
      { status: 'found', lockfile: { lockfileVersion: 1, sources } },
      config,
    )
    createSyncAliases(
      packages.flatMap((pkg) =>
        pkg.skills.map((skill) => ({
          kind: pkg.kind,
          id: pkg.name,
          skill: skill.name,
        })),
      ),
    )
  })

  bench('plans changed and pending sources', () => {
    const changed = sources.map((source, index) =>
      index === 0
        ? {
            ...source,
            skills: source.skills.map((skill, skillIndex) =>
              skillIndex === 0 ? { ...skill, contentHash: 'changed' } : skill,
            ),
          }
        : source,
    )
    buildInstallDeltaInventory(
      packages,
      changed,
      { status: 'found', lockfile: { lockfileVersion: 1, sources } },
      { ...config, skills: ['@bench/package-00'] },
    )
  })
})
