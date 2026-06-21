import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fail } from '../cli-error.js'
import { EDIT_TOOLS_BY_AGENT, GATE_DENY_REASON } from './policy.js'
import type { HookAgent } from './types.js'

export type HookInstallScope = 'project' | 'user'

export type HookInstallStatus = 'created' | 'skipped' | 'unchanged' | 'updated'

export type HookInstallResult = {
  agent: HookAgent
  configPath: string | null
  scope: HookInstallScope
  scriptPath: string | null
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

const ALL_HOOK_AGENTS: Array<HookAgent> = ['copilot', 'claude', 'codex']
const PROJECT_HOOK_AGENTS = new Set<HookAgent>(['claude', 'codex'])
const HOOK_SCRIPT_DIR = '.intent/hooks'
const STATUS_MESSAGE = 'Checking Intent guidance'

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

export function buildHookRunnerScript(agent: HookAgent): string {
  const editTools = [...EDIT_TOOLS_BY_AGENT[agent]].sort()

  return `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const AGENT = ${JSON.stringify(agent)}
const EDIT_TOOLS = new Set(${JSON.stringify(editTools)})
const GATE_DENY_REASON = ${JSON.stringify(GATE_DENY_REASON)}
const INTENT_COMMAND_PATTERN = /(?:^|\\s|&&|;|\\|)\\s*((?:bunx\\s+@tanstack\\/intent(?:@latest)?)|(?:pnpm\\s+exec\\s+intent)|(?:pnpm\\s+dlx\\s+@tanstack\\/intent(?:@latest)?)|(?:npx\\s+@tanstack\\/intent(?:@latest)?)|(?:yarn\\s+dlx\\s+@tanstack\\/intent(?:@latest)?)|(?:intent))\\s+(list|load)(?:\\s+([^\\s|;&]+))?/i

try {
  const event = readEventFromStdin()
  const stateFile = stateFileForEvent(event)
  const observation = observationFromEvent(event)

  if (observation) {
    appendObservation(stateFile, observation)
  }

  const toolName = event?.tool_name ?? event?.toolName
  if (typeof toolName === 'string' && EDIT_TOOLS.has(toolName) && !hasLoad(stateFile)) {
    process.stdout.write(JSON.stringify(denyOutput()))
  }
} catch {
}

process.exit(0)

function readEventFromStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

function stateFileForEvent(event) {
  const sessionId = typeof event?.session_id === 'string' ? event.session_id : 'unknown'
  const cwd = typeof event?.cwd === 'string' ? event.cwd : process.cwd()
  const key = createHash('sha256').update(AGENT + '\\0' + cwd + '\\0' + sessionId).digest('hex')
  return join(tmpdir(), 'tanstack-intent-hooks', key + '.jsonl')
}

function observationFromEvent(event) {
  if (!event || typeof event !== 'object') return undefined
  const toolName = event.tool_name ?? event.toolName
  const toolInput = event.tool_input ?? event.toolArgs
  if (toolName !== 'Bash') return undefined
  const command = typeof toolInput === 'string' ? safeCommandFromString(toolInput) : commandFromObject(toolInput)
  const parsed = parseIntentInvocation(command)
  if (!parsed || typeof command !== 'string') return undefined
  return { action: parsed.action, skillUse: parsed.skillUse, raw: command }
}

function parseIntentInvocation(command) {
  if (typeof command !== 'string') return undefined
  const match = command.match(INTENT_COMMAND_PATTERN)
  if (!match?.[1] || !match[2]) return undefined
  const action = match[2].toLowerCase()
  if (action !== 'list' && action !== 'load') return undefined
  const skillUse = action === 'load' ? match[3] : undefined
  if (action === 'load' && !skillUse) return undefined
  return action === 'load' ? { action, skillUse } : { action }
}

function commandFromObject(value) {
  return value && typeof value === 'object' ? value.command : undefined
}

function safeCommandFromString(value) {
  try {
    const command = commandFromObject(JSON.parse(value))
    return typeof command === 'string' ? command : value
  } catch {
    return value
  }
}

function appendObservation(stateFile, observation) {
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    appendFileSync(stateFile, JSON.stringify({ ts: new Date().toISOString(), ...observation }) + '\\n')
  } catch {
  }
}

function hasLoad(stateFile) {
  if (!existsSync(stateFile)) return false
  try {
    return readFileSync(stateFile, 'utf8')
      .split('\\n')
      .filter(Boolean)
      .some((line) => {
        try {
          return JSON.parse(line).action === 'load'
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

function denyOutput() {
  if (AGENT === 'copilot') {
    return { permissionDecision: 'deny', permissionDecisionReason: GATE_DENY_REASON }
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: GATE_DENY_REASON,
    },
  }
}
`
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
  if (scope === 'project' && !PROJECT_HOOK_AGENTS.has(agent)) {
    return {
      agent,
      configPath: null,
      reason: 'project scope is not supported; use --scope user',
      scope,
      scriptPath: null,
      status: 'skipped',
    }
  }

  switch (agent) {
    case 'claude':
      return installClaudeHook({ agent, homeDir, root, scope })
    case 'codex':
      return installCodexHook({ agent, homeDir, root, scope })
    case 'copilot':
      return installCopilotHook({ agent, copilotHome, homeDir, scope })
  }
}

function installClaudeHook({
  agent,
  homeDir,
  root,
  scope,
}: {
  agent: HookAgent
  homeDir: string
  root: string
  scope: HookInstallScope
}): HookInstallResult {
  const project = scope === 'project'
  const scriptPath = project
    ? join(root, HOOK_SCRIPT_DIR, 'intent-claude-gate.mjs')
    : join(homeDir, '.tanstack', 'intent', 'hooks', 'intent-claude-gate.mjs')
  const configPath = project
    ? join(root, '.claude', 'settings.json')
    : join(homeDir, '.claude', 'settings.json')
  const scriptStatus = writeIfChanged(scriptPath, buildHookRunnerScript(agent))
  const configStatus = updateJsonConfig(configPath, (config) =>
    upsertClaudePreToolUseHook(config, project, scriptPath),
  )

  return hookInstallResult({
    agent,
    configPath,
    scope,
    scriptPath,
    scriptStatus,
    configStatus,
  })
}

function installCodexHook({
  agent,
  homeDir,
  root,
  scope,
}: {
  agent: HookAgent
  homeDir: string
  root: string
  scope: HookInstallScope
}): HookInstallResult {
  const project = scope === 'project'
  const scriptPath = project
    ? join(root, HOOK_SCRIPT_DIR, 'intent-codex-gate.mjs')
    : join(homeDir, '.tanstack', 'intent', 'hooks', 'intent-codex-gate.mjs')
  const configPath = project
    ? join(root, '.codex', 'hooks.json')
    : join(homeDir, '.codex', 'hooks.json')
  const scriptStatus = writeIfChanged(scriptPath, buildHookRunnerScript(agent))
  const configStatus = updateJsonConfig(configPath, (config) =>
    upsertCodexPreToolUseHook(config, project, scriptPath),
  )

  return hookInstallResult({
    agent,
    configPath,
    scope,
    scriptPath,
    scriptStatus,
    configStatus,
  })
}

function installCopilotHook({
  agent,
  copilotHome,
  homeDir,
  scope,
}: {
  agent: HookAgent
  copilotHome?: string
  homeDir: string
  scope: HookInstallScope
}): HookInstallResult {
  const resolvedCopilotHome =
    copilotHome ?? process.env.COPILOT_HOME ?? join(homeDir, '.copilot')
  const scriptPath = join(
    homeDir,
    '.tanstack',
    'intent',
    'hooks',
    'intent-copilot-gate.mjs',
  )
  const configPath = join(resolvedCopilotHome, 'hooks', 'hooks.json')
  const scriptStatus = writeIfChanged(scriptPath, buildHookRunnerScript(agent))
  const configStatus = updateJsonConfig(configPath, (config) =>
    upsertCopilotPreToolUseHook(config, scriptPath),
  )

  return hookInstallResult({
    agent,
    configPath,
    scope,
    scriptPath,
    scriptStatus,
    configStatus,
  })
}

function hookInstallResult({
  agent,
  configPath,
  configStatus,
  scope,
  scriptPath,
  scriptStatus,
}: {
  agent: HookAgent
  configPath: string
  configStatus: HookInstallStatus
  scope: HookInstallScope
  scriptPath: string
  scriptStatus: HookInstallStatus
}): HookInstallResult {
  return {
    agent,
    configPath,
    scope,
    scriptPath,
    status:
      scriptStatus === 'created' || configStatus === 'created'
        ? 'created'
        : scriptStatus === 'updated' || configStatus === 'updated'
          ? 'updated'
          : 'unchanged',
  }
}

function upsertClaudePreToolUseHook(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.PreToolUse = upsertHookGroup(arrayValue(hooks.PreToolUse), {
    matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit',
    hooks: [
      {
        type: 'command',
        command: 'node',
        args: [
          project
            ? '${CLAUDE_PROJECT_DIR}/.intent/hooks/intent-claude-gate.mjs'
            : scriptPath,
        ],
        timeout: 10,
        statusMessage: STATUS_MESSAGE,
      },
    ],
  })
  return { ...config, hooks }
}

function upsertCodexPreToolUseHook(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.PreToolUse = upsertHookGroup(arrayValue(hooks.PreToolUse), {
    matcher: 'Bash|apply_patch|Edit|Write',
    hooks: [
      {
        type: 'command',
        command: project
          ? 'node "$(git rev-parse --show-toplevel)/.intent/hooks/intent-codex-gate.mjs"'
          : `node ${quoteShell(scriptPath)}`,
        timeout: 10,
        statusMessage: STATUS_MESSAGE,
      },
    ],
  })
  return { ...config, hooks }
}

function upsertCopilotPreToolUseHook(
  config: Record<string, unknown>,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.PreToolUse = upsertHookGroup(arrayValue(hooks.PreToolUse), {
    command: `node ${quoteShell(scriptPath)}`,
  })
  return { ...config, hooks }
}

function upsertHookGroup(
  groups: Array<unknown>,
  nextGroup: Record<string, unknown>,
): Array<unknown> {
  return [...groups.filter((group) => !containsIntentHook(group)), nextGroup]
}

function containsIntentHook(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const hooks = arrayValue((value as { hooks?: unknown }).hooks)
  return hooks.some(
    (hook) =>
      JSON.stringify(hook).includes('intent-') &&
      JSON.stringify(hook).includes('-gate.mjs'),
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

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, next)
  return existed ? 'updated' : 'created'
}

function writeIfChanged(filePath: string, content: string): HookInstallStatus {
  const existed = existsSync(filePath)
  if (existed && readFileSync(filePath, 'utf8') === content) {
    return 'unchanged'
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
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

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function formatPath(filePath: string): string {
  return relative(process.cwd(), filePath) || filePath
}
