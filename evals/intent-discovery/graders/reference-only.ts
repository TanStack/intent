import { jsonToSearchableText, textMatchesSkillArea } from './skill-areas'
import { discoveryInvocation } from './strict-invocation'
import type { HarnessRun } from 'vitest-evals'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'

export function referenceOnly(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
  condition: IntentDiscoveryCondition,
): boolean {
  if (discoveryInvocation(run, condition).passed) {
    return false
  }

  const transcriptText = run.session.messages
    .filter((message) => message.role !== 'user')
    .map((message) => jsonToSearchableText(message.content))
    .join('\n')

  return textMatchesSkillArea(transcriptText, expectedSkillAreas)
}
