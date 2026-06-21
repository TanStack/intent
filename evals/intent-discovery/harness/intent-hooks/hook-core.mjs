const INTENT_COMMAND_PATTERN =
  /(?:^|&&|\|\||;|\|)\s*((?:bunx\s+@tanstack\/intent(?:@latest)?)|(?:pnpm\s+exec\s+intent)|(?:pnpm\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:npx\s+@tanstack\/intent(?:@latest)?)|(?:yarn\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:intent))\s+(list|load)(?:\s+([^\s|;&]+))?/i

export const EDIT_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])

export const GATE_DENY_REASON =
  'Blocked: load the matching TanStack guidance before editing. Use the guidance command from the AGENTS.md tanstackIntent block, then retry the edit.'

export function parseIntentInvocation(command) {
  if (typeof command !== 'string') {
    return undefined
  }

  const match = command.match(INTENT_COMMAND_PATTERN)

  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const action = match[2].toLowerCase()
  const skillUse = action === 'load' ? match[3] : undefined

  if (action === 'load' && !skillUse) {
    return undefined
  }

  return { action, skillUse }
}

export function observationFromEvent(event) {
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
      : toolInput?.command

  const parsed = parseIntentInvocation(command)

  if (!parsed) {
    return undefined
  }

  return { action: parsed.action, skillUse: parsed.skillUse, raw: command }
}

export function gateDecision({ toolName, hasLoaded }) {
  if (EDIT_TOOLS.has(toolName) && !hasLoaded) {
    return { decision: 'deny', reason: GATE_DENY_REASON }
  }

  return { decision: 'allow' }
}

export function hasLoadFromObservations(observations) {
  return observations.some((entry) => entry?.action === 'load')
}

function safeCommandFromString(value) {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed?.command === 'string' ? parsed.command : value
  } catch {
    return value
  }
}
