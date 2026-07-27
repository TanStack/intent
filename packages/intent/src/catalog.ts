import { readFileSync } from 'node:fs'
import { applyCatalogueLock } from './catalog-lock.js'
import { getProjectReadFs } from './discovery/scanner.js'
import {
  formatSessionCatalogue,
  getSessionCatalogue,
  resolveCatalogueWorkspaceRoot,
} from './session-catalog.js'
import type { HookAgent } from './hooks/types.js'

export type { HookAgent } from './hooks/types.js'

export interface IntentCatalogContext {
  cacheStatus: 'hit' | 'miss' | 'refresh'
  context: string
}

export async function getIntentCatalogContext({
  cwd,
  refresh = false,
}: {
  cwd: string
  refresh?: boolean
}): Promise<IntentCatalogContext> {
  const workspaceRoot = resolveCatalogueWorkspaceRoot(cwd)
  const readFs = getProjectReadFs(workspaceRoot)
  const result = await getSessionCatalogue({
    root: workspaceRoot,
    policyRoot: cwd,
    readFs,
    refresh,
    discover: async () => {
      const { listIntentSkills } = await import('./core/index.js')
      const discovered = listIntentSkills({
        audience: 'agent',
        cwd,
      })
      return applyCatalogueLock(discovered, workspaceRoot, readFs)
    },
  })
  const context = formatSessionCatalogue(result.catalogue)

  return {
    cacheStatus: result.cacheStatus,
    context,
  }
}

export async function runSessionCatalogueHook({
  agent,
  event = readEventFromStdin(),
}: {
  agent: HookAgent
  event?: Record<string, unknown>
}): Promise<void> {
  const eventName = getLifecycleEventName(agent, event)
  if (!eventName) return

  let context: string
  try {
    const result = await getIntentCatalogContext({ cwd: getEventCwd(event) })
    context = result.context
  } catch (error) {
    logHookFailure(error)
    context =
      'Intent skills are unavailable because the catalogue could not be built. Run `intent catalog` outside the agent session for details.'
  }

  try {
    process.stdout.write(
      JSON.stringify(formatHookOutput(agent, eventName, context)),
    )
  } catch (error) {
    logHookFailure(error)
  }
}

function logHookFailure(error: unknown): void {
  console.error(
    `[intent catalog] hook failed open: ${error instanceof Error ? error.message : String(error)}`,
  )
}

function readEventFromStdin(): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(0, 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function getLifecycleEventName(
  agent: HookAgent,
  event: Record<string, unknown>,
): 'SessionStart' | 'SubagentStart' | null {
  const explicit = event.hook_event_name ?? event.hookEventName
  if (explicit === 'SessionStart' || explicit === 'sessionStart') {
    return 'SessionStart'
  }
  if (explicit === 'SubagentStart' || explicit === 'subagentStart') {
    return 'SubagentStart'
  }
  if (agent === 'copilot') {
    if (typeof event.agentName === 'string') return 'SubagentStart'
    if (
      event.source === 'startup' ||
      event.source === 'resume' ||
      event.source === 'new'
    ) {
      return 'SessionStart'
    }
  }
  return null
}

function getEventCwd(event: Record<string, unknown>): string {
  return typeof event.cwd === 'string' ? event.cwd : process.cwd()
}

function formatHookOutput(
  agent: HookAgent,
  eventName: 'SessionStart' | 'SubagentStart',
  additionalContext: string,
): Record<string, unknown> {
  if (agent === 'copilot') return { additionalContext }
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  }
}
