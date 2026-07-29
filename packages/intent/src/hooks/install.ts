import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { relative } from 'node:path'
import { detectPackageManager } from '../discovery/package-manager.js'
import { writeTextFileAtomic } from '../shared/atomic-write.js'
import { fail } from '../shared/cli-error.js'
import { formatIntentCommand } from '../shared/command-runner.js'
import { ALL_HOOK_AGENTS, HOOK_AGENT_ADAPTERS } from './adapters.js'
import type { HookAgent, HookInstallScope } from './types.js'

type HookInstallStatus = 'created' | 'skipped' | 'unchanged' | 'updated'

type HookInstallResult = {
  agent: HookAgent
  configPath: string | null
  scope: HookInstallScope
  status: HookInstallStatus
  reason?: string
}

export type InstallHooksOptions = {
  agents?: string
  copilotHome?: string
  homeDir?: string
  root: string
  scope?: string
}

const CATALOG_STATUS_MESSAGE = 'Loading Intent skill catalog'

export function runInstallHooks({
  agents,
  copilotHome,
  homeDir = homedir(),
  root,
  scope,
}: InstallHooksOptions): Array<HookInstallResult> {
  const resolvedScope = parseScope(scope)
  const resolvedAgents = parseAgents(agents)

  return resolvedAgents.map((agent) =>
    installAgentHook({
      agent,
      copilotHome,
      homeDir,
      root,
      scope: resolvedScope,
    }),
  )
}

export function formatHookInstallResult(result: HookInstallResult): string {
  if (result.status === 'skipped') {
    return `Skipped Intent hooks for ${result.agent}: ${result.reason}`
  }

  const target = result.configPath
    ? formatPath(result.configPath)
    : result.agent
  switch (result.status) {
    case 'created':
      return `Installed Intent hooks for ${result.agent} (${result.scope}) in ${target}.`
    case 'updated':
      return `Updated Intent hooks for ${result.agent} (${result.scope}) in ${target}.`
    case 'unchanged':
      return `No changes to Intent hooks for ${result.agent} (${result.scope}); already current.`
  }
}

function installAgentHook({
  agent,
  copilotHome,
  homeDir,
  root,
  scope,
}: {
  agent: HookAgent
  copilotHome?: string
  homeDir: string
  root: string
  scope: HookInstallScope
}): HookInstallResult {
  const adapter = HOOK_AGENT_ADAPTERS[agent]

  if (!adapter.supportedScopes.has(scope)) {
    return {
      agent,
      configPath: null,
      reason: 'project scope is not supported; use --scope user',
      scope,
      status: 'skipped',
    }
  }

  const { configPath } = adapter.paths(scope, {
    copilotHome: copilotHome ?? process.env.COPILOT_HOME,
    homeDir,
    root,
  })
  const catalogCommand = formatIntentCommand(
    detectPackageManager(root),
    `hooks run --agent ${agent}`,
  )
  const configStatus = updateJsonConfig(configPath, (config) =>
    upsertAdapterHooks({
      catalogCommand,
      config,
      configKind: adapter.configKind,
    }),
  )

  return {
    agent,
    configPath,
    scope,
    status: configStatus,
  }
}

function upsertAdapterHooks({
  catalogCommand,
  config,
  configKind,
}: {
  catalogCommand: string
  config: Record<string, unknown>
  configKind: (typeof HOOK_AGENT_ADAPTERS)[HookAgent]['configKind']
}): Record<string, unknown> {
  switch (configKind) {
    case 'claude-settings':
    case 'codex-hooks':
      return upsertCommandHooks(config, catalogCommand)
    case 'copilot-hooks':
      return upsertCopilotHooks(config, catalogCommand)
  }
}

function upsertCommandHooks(
  config: Record<string, unknown>,
  catalogCommand: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    matcher: 'startup|resume|clear|compact',
    hooks: [
      {
        type: 'command',
        command: catalogCommand,
        timeout: 10,
        statusMessage: CATALOG_STATUS_MESSAGE,
      },
    ],
  })
  hooks.PreToolUse = removeIntentHooks(arrayValue(hooks.PreToolUse))
  return { ...config, hooks }
}

function upsertCopilotHooks(
  config: Record<string, unknown>,
  catalogCommand: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    command: catalogCommand,
  })
  hooks.PreToolUse = removeIntentHooks(arrayValue(hooks.PreToolUse))
  return { ...config, hooks }
}

function upsertHookGroup(
  groups: Array<unknown>,
  nextGroup: Record<string, unknown>,
): Array<unknown> {
  return [...removeIntentHooks(groups), nextGroup]
}

function removeIntentHooks(groups: Array<unknown>): Array<unknown> {
  return groups.flatMap(withoutIntentHooks)
}

function withoutIntentHooks(value: unknown): Array<unknown> {
  if (!value || typeof value !== 'object') return [value]

  const hooks = arrayValue((value as { hooks?: unknown }).hooks)
  if (hooks.length === 0) return isIntentHook(value) ? [] : [value]

  const nextHooks = hooks.filter((hook) => !isIntentHook(hook))
  if (nextHooks.length === hooks.length) return [value]
  if (nextHooks.length === 0) return []

  return [{ ...(value as Record<string, unknown>), hooks: nextHooks }]
}

function isIntentHook(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  const command = typeof entry.command === 'string' ? entry.command : ''
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg): arg is string => typeof arg === 'string')
    : []

  return [command, ...args].some(isIntentHookReference)
}

function isIntentHookReference(value: string): boolean {
  return (
    /(?:^|[\s"'/])(?:old-)?intent-(claude|codex|copilot)-(?:gate|catalog)\.mjs(?:$|[?#\s"'])/i.test(
      value,
    ) ||
    /@tanstack\/intent(?:@[^\s]+)?\s+hooks\s+run\s+--agent\s+(?:copilot|claude|codex)(?:$|\s)/i.test(
      value,
    )
  )
}

function updateJsonConfig(
  filePath: string,
  update: (config: Record<string, unknown>) => Record<string, unknown>,
): HookInstallStatus {
  const existed = existsSync(filePath)
  const current = existed ? readFileSync(filePath, 'utf8') : ''
  const parsed = current.trim() ? parseJsonObject(filePath, current) : {}
  const next = `${JSON.stringify(update(parsed), null, 2)}\n`

  if (current === next) {
    return 'unchanged'
  }

  writeTextFileAtomic(filePath, next)
  return existed ? 'updated' : 'created'
}

function parseAgents(value: string | undefined): Array<HookAgent> {
  if (!value || value === 'all') {
    return ALL_HOOK_AGENTS
  }

  const agents = value
    .split(',')
    .map((agent) => agent.trim())
    .filter(Boolean)
  const invalid = agents.filter(
    (agent) => !ALL_HOOK_AGENTS.includes(agent as HookAgent),
  )

  if (invalid.length > 0) {
    fail(
      `Unknown hook agent: ${invalid.join(', ')}. Expected copilot, claude, codex, or all.`,
    )
  }

  return [...new Set(agents as Array<HookAgent>)]
}

function parseScope(value: string | undefined): HookInstallScope {
  if (!value) return 'project'
  if (value === 'project' || value === 'user') return value
  fail(`Unknown hook scope: ${value}. Expected project or user.`)
}

function parseJsonObject(
  filePath: string,
  content: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (err) {
    fail(
      `Failed to parse ${formatPath(filePath)}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  fail(`Failed to parse ${formatPath(filePath)}: expected a JSON object.`)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function arrayValue(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : []
}

function formatPath(filePath: string): string {
  return relative(process.cwd(), filePath) || filePath
}
