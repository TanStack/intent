export type HookAgent = 'claude' | 'codex' | 'copilot'

export type HookInstallScope = 'project' | 'user'

export type IntentInvocation = {
  action: 'list' | 'load'
  skillUse?: string
}

export type IntentObservation = IntentInvocation & {
  raw: string
}

export type HookDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }

export type ToolEvent = {
  tool_name?: unknown
  toolName?: unknown
  tool_input?: unknown
  toolArgs?: unknown
}
