import { intentCommandsFromRun } from '../harness/parse-intent-commands'
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
