import { bench, describe } from 'vitest'
import { updateIntentConsumerConfigText } from '../../packages/intent/src/commands/install/config.js'
import { buildSkillSelectionPlan } from '../../packages/intent/src/commands/install/plan.js'
import { createRepresentativeIntentPackages } from './helpers.js'

const packages = createRepresentativeIntentPackages()

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
