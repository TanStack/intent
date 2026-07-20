import { bench, describe } from 'vitest'
import { updateIntentConsumerConfigText } from '../../packages/intent/src/commands/install/config.js'
import { buildSkillSelectionPlan } from '../../packages/intent/src/commands/install/plan.js'
import type { IntentPackage } from '../../packages/intent/src/shared/types.js'

const packages: Array<IntentPackage> = Array.from(
  { length: 20 },
  (_, packageIndex) => ({
    name: `@bench/package-${String(packageIndex).padStart(2, '0')}`,
    version: '1.0.0',
    kind: 'npm',
    source: 'local',
    packageRoot: `node_modules/@bench/package-${packageIndex}`,
    intent: { version: 1, repo: 'bench/packages', docs: 'docs/' },
    skills: Array.from({ length: 5 }, (_, skillIndex) => ({
      name: `skill-${skillIndex}`,
      path: `skills/skill-${skillIndex}/SKILL.md`,
      description: `Skill ${skillIndex}`,
    })),
  }),
)

const packageJson = `${JSON.stringify(
  {
    name: 'install-plan-benchmark',
    private: true,
    intent: { skills: [], exclude: [] },
  },
  null,
  2,
)}\n`

const selection = buildSkillSelectionPlan(packages, { mode: 'all-found' })

describe('installer planning', () => {
  bench('plans 100 discovered skills', () => {
    buildSkillSelectionPlan(packages, { mode: 'all-found' })
  })

  bench('updates consumer JSONC configuration', () => {
    updateIntentConsumerConfigText(packageJson, {
      skills: selection.skills,
      exclude: selection.exclude,
      install: { method: 'symlink', targets: ['agents'] },
    })
  })
})
