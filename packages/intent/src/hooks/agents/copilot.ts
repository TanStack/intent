import type { HookDecision } from '../types.js'

export type CopilotHookOutput = {
  permissionDecision: 'deny'
  permissionDecisionReason: string
}

export function formatCopilotPreToolUseOutput(
  decision: HookDecision,
): CopilotHookOutput | undefined {
  if (decision.decision === 'allow') {
    return undefined
  }

  return {
    permissionDecision: 'deny',
    permissionDecisionReason: decision.reason,
  }
}
