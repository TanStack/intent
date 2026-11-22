export type HookAgent = 'claude' | 'codex' | 'copilot'

export type HookInstallScope = 'project' | 'user'

export type IntentInvocation = {
  action: 'list' | 'load'
  skillUse?: string
}
