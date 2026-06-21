import type { HookDecision } from '../types.js'

export type CodexHookOutput = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}

export function formatCodexPreToolUseOutput(
  decision: HookDecision,
): CodexHookOutput | undefined {
  if (decision.decision === 'allow') {
    return undefined
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reason,
    },
  }
}
