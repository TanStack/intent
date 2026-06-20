import type { HarnessRun } from 'vitest-evals'
import type { ExpectedSkillArea } from '../corpus/tasks'
import { jsonToSearchableText, textMatchesSkillArea } from './skill-areas'
import { strictIntentInvocation } from './strict-invocation'

export function referenceOnly(
  run: HarnessRun,
  expectedSkillAreas: ExpectedSkillArea[],
): boolean {
  if (strictIntentInvocation(run).passed) {
    return false
  }

  const transcriptText = run.session.messages
    .map((message) => jsonToSearchableText(message.content))
    .join('\n')

  return textMatchesSkillArea(transcriptText, expectedSkillAreas)
}
