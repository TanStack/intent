import { correctSkillLoaded } from './correct-skill-loaded'
import { referenceOnly } from './reference-only'
import { discoveryInvocation } from './strict-invocation'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type {
  ExpectedSkillArea,
  IntentDiscoveryFailureClass,
} from '../corpus/tasks'
import type { HarnessRun } from 'vitest-evals'

export function classifyFailure(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
  condition: IntentDiscoveryCondition,
): IntentDiscoveryFailureClass {
  if (run.errors.length > 0) {
    return 'harness-error'
  }

  const invocation = discoveryInvocation(run, condition)
  const skillLoaded = correctSkillLoaded(run, expectedSkillAreas, condition)

  if (invocation.passed && skillLoaded.passed) {
    return 'strict-success'
  }

  if (invocation.passed && skillLoaded.loadedSkills.length > 0) {
    return 'wrong-skill-selected'
  }

  if (invocation.passed) {
    return 'command-attempted-but-failed'
  }

  if (referenceOnly(run, expectedSkillAreas, condition)) {
    return 'reference-only'
  }

  return 'no-discovery-attempt'
}
