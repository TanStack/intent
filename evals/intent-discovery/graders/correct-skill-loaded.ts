import { expectedSkillUseByArea } from '../corpus/skill-uses'
import {
  loadedSkillUsesFromRun,
  nativeSkillUsesFromRun,
} from '../harness/parse-intent-commands'
import { listIncludesExpectedSkillArea } from './skill-areas'
import type { HarnessRun } from 'vitest-evals'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'

export type CorrectSkillLoadedResult = {
  passed: boolean
  loadedSkills: Array<string>
}

export function correctSkillLoaded(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
  condition: IntentDiscoveryCondition,
): CorrectSkillLoadedResult {
  const intentSkills = loadedSkillUsesFromRun(run)
  const nativeSkills =
    condition === 'symlink-intent' ? nativeSkillUsesFromRun(run) : []

  return {
    passed:
      listIncludesExpectedSkillArea(intentSkills, expectedSkillAreas) ||
      expectedSkillAreas.some((area) =>
        nativeSkills.includes(expectedSkillUseByArea[area]),
      ),
    loadedSkills: [...new Set([...intentSkills, ...nativeSkills])],
  }
}
