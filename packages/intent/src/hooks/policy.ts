import type {
  HookAgent,
  HookDecision,
  IntentInvocation,
  IntentObservation,
  ToolEvent,
} from './types.js'

const INTENT_COMMAND_PATTERN =
  /(?:^|&&|\|\||;|\|)\s*((?:bunx\s+@tanstack\/intent(?:@latest)?)|(?:pnpm\s+exec\s+intent)|(?:pnpm\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:npx\s+@tanstack\/intent(?:@latest)?)|(?:yarn\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:intent))\s+(list|load)(?:\s+([^\s|;&]+))?/i

export const EDIT_TOOLS_BY_AGENT: Record<HookAgent, ReadonlySet<string>> = {
  claude: new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']),
  codex: new Set(['apply_patch', 'Write', 'Edit']),
  copilot: new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']),
}

export const GATE_DENY_REASON =
  "Blocked: load matching TanStack guidance before editing. Follow this repo's TanStack guidance setup, then retry the edit."

export function parseIntentInvocation(
  command: unknown,
): IntentInvocation | undefined {
  if (typeof command !== 'string') {
    return undefined
  }

  const match = command.match(INTENT_COMMAND_PATTERN)

  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const action = match[2].toLowerCase()

  if (action !== 'list' && action !== 'load') {
    return undefined
  }

  const skillUse = action === 'load' ? match[3] : undefined

  if (action === 'load' && !skillUse) {
    return undefined
  }

  return action === 'load' ? { action, skillUse } : { action }
}

export function observationFromEvent(
  event: ToolEvent | undefined,
): IntentObservation | undefined {
  if (!event || typeof event !== 'object') {
    return undefined
  }

  const toolName = event.tool_name ?? event.toolName
  const toolInput = event.tool_input ?? event.toolArgs

  if (toolName !== 'Bash') {
    return undefined
  }

  const command =
    typeof toolInput === 'string'
      ? safeCommandFromString(toolInput)
      : commandFromObject(toolInput)

  const parsed = parseIntentInvocation(command)

  if (!parsed || typeof command !== 'string') {
    return undefined
  }

  return { action: parsed.action, skillUse: parsed.skillUse, raw: command }
}

export function gateDecision({
  agent,
  hasLoaded,
  toolName,
}: {
  agent: HookAgent
  hasLoaded: boolean
  toolName: string
}): HookDecision {
  if (EDIT_TOOLS_BY_AGENT[agent].has(toolName) && !hasLoaded) {
    return { decision: 'deny', reason: GATE_DENY_REASON }
  }

  return { decision: 'allow' }
}

export function hasLoadFromObservations(
  observations: Array<Pick<IntentObservation, 'action'> | undefined>,
): boolean {
  return observations.some((entry) => entry?.action === 'load')
}

function commandFromObject(value: unknown): unknown {
  return value && typeof value === 'object'
    ? (value as { command?: unknown }).command
    : undefined
}

function safeCommandFromString(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    const command = commandFromObject(parsed)
    return typeof command === 'string' ? command : value
  } catch {
    return value
  }
}
