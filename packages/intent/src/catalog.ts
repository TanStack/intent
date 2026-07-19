import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import {
  formatSessionCatalogue,
  getSessionCatalogue,
  resolveCatalogueWorkspaceRoot,
} from './session-catalog.js'
import type { HookAgent } from './hooks/types.js'

export type { HookAgent } from './hooks/types.js'

export interface IntentCatalogDiagnostics {
  discoveryPackageJsonReadCount: number
  durationMs: number
  packageCount: number
  skillCount: number
  sizeBytes: number
}

export interface IntentCatalogContext {
  cacheStatus: 'hit' | 'miss' | 'refresh'
  context: string
  diagnostics: IntentCatalogDiagnostics
  workspaceRoot: string
}

export async function getIntentCatalogContext({
  cwd,
  refresh = false,
}: {
  cwd: string
  refresh?: boolean
}): Promise<IntentCatalogContext> {
  const workspaceRoot = resolveCatalogueWorkspaceRoot(cwd)
  const startedAt = performance.now()
  let packageJsonReadCount = 0
  const result = await getSessionCatalogue({
    root: workspaceRoot,
    policyRoot: cwd,
    refresh,
    discover: async () => {
      const { listIntentSkills } = await import('./core/index.js')
      const discovered = listIntentSkills({
        audience: 'agent',
        cwd,
        debug: true,
      })
      packageJsonReadCount = discovered.debug?.scan.packageJsonReadCount ?? 0
      return discovered
    },
  })
  const context = formatSessionCatalogue(result.catalogue)

  return {
    cacheStatus: result.cacheStatus,
    context,
    diagnostics: {
      discoveryPackageJsonReadCount: packageJsonReadCount,
      durationMs: performance.now() - startedAt,
      packageCount: result.catalogue.packageCount,
      skillCount: result.catalogue.totalSkillCount,
      sizeBytes: Buffer.byteLength(context),
    },
    workspaceRoot: result.workspaceRoot,
  }
}

export async function runSessionCatalogueHook({
  agent,
  event = readEventFromStdin(),
}: {
  agent: HookAgent
  event?: Record<string, unknown>
}): Promise<void> {
  try {
    const eventName = getLifecycleEventName(agent, event)
    if (!eventName) return

    const result = await getIntentCatalogContext({ cwd: getEventCwd(event) })
    const diagnostics = result.diagnostics
    console.error(
      `[intent catalog] ${eventName} ${result.cacheStatus}; ${diagnostics.skillCount} skills; ${diagnostics.sizeBytes} bytes; ${diagnostics.durationMs.toFixed(1)}ms; discoveryPackageJsonReadCount=${diagnostics.discoveryPackageJsonReadCount}`,
    )
    process.stdout.write(
      JSON.stringify(formatHookOutput(agent, eventName, result.context)),
    )
  } catch (error) {
    console.error(
      `[intent catalog] hook failed open: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
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
