import type { HookDecision } from '../types.js'

export type ClaudeHookOutput = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}

export function formatClaudePreToolUseOutput(
  decision: HookDecision,
): ClaudeHookOutput | undefined {
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
