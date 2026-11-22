import type { HookAgent, IntentInvocation } from './types.js'

export const EDIT_TOOLS_BY_AGENT: Record<HookAgent, ReadonlySet<string>> = {
  claude: new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']),
  codex: new Set(['apply_patch', 'Write', 'Edit']),
  copilot: new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']),
}

export const GATE_DENY_REASON =
  'Blocked: check TanStack guidance before editing. If a listed skill matches, load it, then retry the edit.'

export const INTENT_INVOCATION_PATTERN =
  /(?:^|&&|\|\||;|\|)\s*((?:bunx\s+--no-install\s+--package\s+@tanstack\/intent\s+intent)|(?:npm\s+exec\s+--no\s+--\s+intent)|(?:yarn\s+exec\s+intent)|(?:bunx\s+@tanstack\/intent(?:@latest)?)|(?:pnpm\s+exec\s+intent)|(?:pnpm\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:npx\s+@tanstack\/intent(?:@latest)?)|(?:yarn\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:(?:[^\s|;&]*[\\/])?intent))\s+(list|load)(?:\s+([^\s|;&]+))?/i

export function parseIntentInvocation(
  command: unknown,
): IntentInvocation | undefined {
  if (typeof command !== 'string') {
    return undefined
  }

  // The bare `intent` form also accepts a path prefix such as
  // `node_modules/.bin/intent`, which the session catalog suggests when the
  // project has the CLI installed.
  const match = command.match(INTENT_INVOCATION_PATTERN)

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
