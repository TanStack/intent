import { jsonToSearchableText, textMatchesSkillArea } from './skill-areas'
import { strictIntentInvocation } from './strict-invocation'
import type { HarnessRun } from 'vitest-evals'
import type { ExpectedSkillArea } from '../corpus/tasks'

export function referenceOnly(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): boolean {
  if (strictIntentInvocation(run).passed) {
    return false
  }

  const transcriptText = run.session.messages
    .filter((message) => message.role !== 'user')
    .map((message) => jsonToSearchableText(message.content))
    .join('\n')

  return textMatchesSkillArea(transcriptText, expectedSkillAreas)
}
