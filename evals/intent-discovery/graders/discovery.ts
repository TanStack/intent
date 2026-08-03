import { skillUse } from '../corpus/skill-uses'
import {
  intentCommandsFromRun,
  loadedSkillUsesFromRun,
  nativeSkillUsesFromRun,
} from '../harness/parse-intent-commands'
import {
  jsonToSearchableText,
  listIncludesExpectedSkillArea,
  textMatchesSkillArea,
} from './skill-areas'
import type { HarnessRun } from 'vitest-evals'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type {
  ExpectedSkillArea,
  IntentDiscoveryFailureClass,
} from '../corpus/tasks'

export function gradeDiscovery(
  run: HarnessRun,
  expectedSkillAreas: Array<ExpectedSkillArea>,
  condition: IntentDiscoveryCondition,
) {
  const command = intentCommandsFromRun(run)[0]
  const strict = command
    ? { passed: true, matchedCommand: command.raw, source: command.source }
    : { passed: false as const }
  const nativeSkills =
    condition === 'symlink-intent' ? nativeSkillUsesFromRun(run) : []
  const intentSkills = loadedSkillUsesFromRun(run)
  const loadedSkills = [...new Set([...intentSkills, ...nativeSkills])]
  const loaded = {
    passed:
      listIncludesExpectedSkillArea(intentSkills, expectedSkillAreas) ||
      expectedSkillAreas.some((area) => nativeSkills.includes(skillUse(area))),
    loadedSkills,
  }
  const discovery = {
    mechanism:
      condition === 'symlink-intent'
        ? ('native-skill' as const)
        : ('intent-command' as const),
    passed:
      condition === 'symlink-intent' ? nativeSkills.length > 0 : strict.passed,
  }
  const reference =
    !discovery.passed &&
    textMatchesSkillArea(
      run.session.messages
        .filter((message) => message.role !== 'user')
        .map((message) => jsonToSearchableText(message.content))
        .join('\n'),
      expectedSkillAreas,
    )

  let failureClass: IntentDiscoveryFailureClass = 'no-discovery-attempt'
  if (run.errors.length > 0) failureClass = 'harness-error'
  else if (discovery.passed && loaded.passed) failureClass = 'strict-success'
  else if (discovery.passed && loadedSkills.length > 0)
    failureClass = 'wrong-skill-selected'
  else if (discovery.passed) failureClass = 'command-attempted-but-failed'
  else if (reference) failureClass = 'reference-only'

  return { discovery, failureClass, loaded, reference, strict }
}
