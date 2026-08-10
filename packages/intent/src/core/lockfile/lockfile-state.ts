import { nodeReadFs } from '../../shared/utils.js'
import { validateSkillPath } from '../skill-path.js'
import { computeSkillContentHash } from './hash.js'
import { canonicalIntentLockfile } from './lockfile.js'
import type { IntentPackage } from '../../shared/types.js'
import type { ReadFs } from '../../shared/utils.js'
import type { IntentLockfileSource } from './lockfile.js'

export function buildCurrentLockfileSources(
  packages: ReadonlyArray<IntentPackage>,
  fs: ReadFs = nodeReadFs,
): Array<IntentLockfileSource> {
  const sources = packages.map((pkg) => ({
    kind: pkg.kind,
    id: pkg.name,
    observedVersion: pkg.version,
    skills: pkg.skills.map((skill) => {
      const path = validateSkillPath(`skills/${skill.name}`)
      return {
        path,
        contentHash: computeSkillContentHash({
          packageRoot: pkg.packageRoot,
          skillDir: path,
          fs,
        }),
      }
    }),
  }))

  return canonicalIntentLockfile({ lockfileVersion: 1, sources }).sources
}
