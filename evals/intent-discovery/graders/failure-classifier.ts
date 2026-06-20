import { correctSkillLoaded } from './correct-skill-loaded'
import { referenceOnly } from './reference-only'
import { strictIntentInvocation } from './strict-invocation'
import type {
  ExpectedSkillArea,
  IntentDiscoveryFailureClass,
} from '../corpus/tasks'
import type { HarnessRun } from 'vitest-evals'

export function classifyFailure(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): IntentDiscoveryFailureClass {
  if (run.errors.length > 0) {
    return 'harness-error'
  }

  const strict = strictIntentInvocation(run)
  const skillLoaded = correctSkillLoaded(run, expectedSkillAreas)

  if (strict.passed && skillLoaded.passed) {
    return 'strict-success'
  }

  if (strict.passed && skillLoaded.loadedSkills.length > 0) {
    return 'wrong-skill-selected'
  }

  if (strict.passed) {
    return 'command-attempted-but-failed'
  }

  if (referenceOnly(run, expectedSkillAreas)) {
    return 'reference-only'
  }

  return 'no-discovery-attempt'
}
