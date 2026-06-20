import { loadedSkillUsesFromRun } from '../harness/parse-intent-commands'
import { listIncludesExpectedSkillArea } from './skill-areas'
import type { HarnessRun } from 'vitest-evals'
import type { ExpectedSkillArea } from '../corpus/tasks'

export type CorrectSkillLoadedResult = {
  passed: boolean
  loadedSkills: Array<string>
}

export function correctSkillLoaded(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): CorrectSkillLoadedResult {
  const loadedSkills = loadedSkillsFromRun(run)

  return {
    passed: listIncludesExpectedSkillArea(loadedSkills, expectedSkillAreas),
    loadedSkills,
  }
}

function loadedSkillsFromRun(run: HarnessRun): Array<string> {
  return loadedSkillUsesFromRun(run)
}
