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
  event,
}: {
  agent: HookAgent
  event?: Record<string, unknown>
}): Promise<void> {
  const resolvedEvent = event ?? (await readEventFromStdin())
  const eventName = getLifecycleEventName(agent, resolvedEvent)
  if (!eventName) return

  let context: string
  try {
    const result = await getIntentCatalogContext({
      cwd: getEventCwd(resolvedEvent),
    })
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

function readEventFromStdin(): Promise<Record<string, unknown>> {
  if (process.stdin.readableEnded || process.stdin.isTTY === true) {
    return Promise.resolve({})
  }

  return new Promise((resolve) => {
    const chunks: Array<Buffer> = []
    let byteLength = 0
    let settled = false
    const timeout = setTimeout(() => finish(true), 1_000)

    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteLength += buffer.byteLength
      if (byteLength > 64 * 1024) {
        finish(false)
        return
      }
      chunks.push(buffer)
    }
    const onEnd = (): void => finish(true)
    const onError = (): void => finish(false)

    function finish(parse: boolean): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.off('error', onError)
      process.stdin.pause()

      if (parse) {
        try {
          const value = JSON.parse(
            Buffer.concat(chunks, byteLength).toString('utf8'),
          ) as unknown
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            resolve(value as Record<string, unknown>)
            return
          }
        } catch {}
      }
      resolve({})
    }

    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.on('error', onError)
    process.stdin.resume()
  })
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
