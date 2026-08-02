import {
  intentCommandsFromRun,
  nativeSkillUsesFromRun,
} from '../harness/parse-intent-commands'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { HarnessRun } from 'vitest-evals'

export type StrictInvocationResult = {
  passed: boolean
  matchedCommand?: string
  source?: 'tool-call' | 'tool-message'
}

export function strictIntentInvocation(
  run: HarnessRun,
): StrictInvocationResult {
  const command = intentCommandsFromRun(run)[0]

  if (!command) {
    return { passed: false }
  }

  return {
    passed: true,
    matchedCommand: command.raw,
    source: command.source,
  }
}

export function discoveryInvocation(
  run: HarnessRun,
  condition: IntentDiscoveryCondition,
): {
  mechanism: 'intent-command' | 'native-skill'
  passed: boolean
} {
  if (condition === 'symlink-intent') {
    return {
      mechanism: 'native-skill',
      passed: nativeSkillUsesFromRun(run).length > 0,
    }
  }

  return {
    mechanism: 'intent-command',
    passed: strictIntentInvocation(run).passed,
  }
}
