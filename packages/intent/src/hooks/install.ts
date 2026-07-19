import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectPackageManager } from '../discovery/package-manager.js'
import { fail } from '../shared/cli-error.js'
import { formatIntentCommand } from '../shared/command-runner.js'
import { ALL_HOOK_AGENTS, HOOK_AGENT_ADAPTERS } from './adapters.js'
import type { HookAgent, HookInstallScope } from './types.js'

type HookInstallStatus = 'created' | 'skipped' | 'unchanged' | 'updated'

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

const CATALOG_STATUS_MESSAGE = 'Loading Intent skill catalogue'

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

export function validateHookInstallOptions({
  agents,
  scope,
}: Pick<InstallHooksOptions, 'agents' | 'scope'>): void {
  parseScope(scope)
  parseAgents(agents)
}

export function buildHookRunnerScript(
  agent: HookAgent,
  catalogCommand = formatIntentCommand(
    detectPackageManager(),
    'catalog --json',
  ),
): string {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const AGENT = ${JSON.stringify(agent)}
const CATALOG_COMMAND = ${JSON.stringify(catalogCommand)}

try {
  main()
} catch (error) {
  console.error(\`[intent catalog] hook failed open: \${error instanceof Error ? error.message : String(error)}\`)
}

process.exit(0)

function main() {
  const event = readEventFromStdin()
  const eventName = eventNameFor(event)
  if (eventName !== 'SessionStart' && eventName !== 'SubagentStart') return

  const result = readCatalogue(rootForEvent(event))
  if (typeof result.context !== 'string' || result.context.length === 0) return

  console.error(
    \`[intent catalog] \${eventName} \${result.cacheStatus ?? 'unknown'}; \${result.skillCount ?? 0} skills; \${result.sizeBytes ?? Buffer.byteLength(result.context)} bytes; \${formatDuration(result.durationMs)}; packageJsonReadCount=\${result.packageJsonReadCount ?? 0}\`,
  )
  process.stdout.write(JSON.stringify(contextOutput(eventName, result.context)))
}

function readEventFromStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

function eventNameFor(event) {
  const explicit = event?.hook_event_name ?? event?.hookEventName
  if (explicit === 'SessionStart' || explicit === 'sessionStart') return 'SessionStart'
  if (explicit === 'SubagentStart' || explicit === 'subagentStart') return 'SubagentStart'
  if (AGENT === 'copilot') {
    return typeof event?.agentName === 'string' ? 'SubagentStart' : 'SessionStart'
  }
  return undefined
}

function rootForEvent(event) {
  return typeof event?.cwd === 'string' ? event.cwd : process.cwd()
}

function readCatalogue(root) {
  const localCli = findLocalIntentCli(root)
  const options = {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, INTENT_AUDIENCE: 'agent' },
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 9000,
  }
  let output
  if (localCli) {
    try {
      output = execFileSync(process.execPath, [localCli, 'catalog', '--json'], options)
    } catch {
      output = undefined
    }
  }
  output ??= execFileSync(CATALOG_COMMAND, { ...options, shell: true })
  return JSON.parse(output)
}

function findLocalIntentCli(start) {
  let current = start
  let previous
  while (current !== previous) {
    const candidate = join(current, 'node_modules', '@tanstack', 'intent', 'dist', 'cli.mjs')
    if (existsSync(candidate)) return candidate
    previous = current
    current = dirname(current)
  }
  return undefined
}

function formatDuration(value) {
  return typeof value === 'number' ? \`\${value.toFixed(1)}ms\` : 'unknown'
}

function contextOutput(eventName, additionalContext) {
  if (AGENT === 'copilot') return { additionalContext }
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  }
}
`
}

export function buildCopilotProjectRunnerScript(
  catalogCommand = formatIntentCommand(
    detectPackageManager(),
    'catalog --json',
  ),
): string {
  return `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CATALOG_COMMAND = ${JSON.stringify(catalogCommand)}

try {
  await main()
} catch (error) {
  console.error(\`[intent catalog] hook failed open: \${error instanceof Error ? error.message : String(error)}\`)
}

process.exitCode = 0

async function main() {
  const event = readEventFromStdin()
  const root = typeof event?.cwd === 'string' ? event.cwd : process.cwd()
  const catalog = await loadLocalCatalog()

  if (!catalog || typeof catalog.runSessionCatalogueHook !== 'function') {
    runFallback(root)
    return
  }

  await catalog.runSessionCatalogueHook({ agent: 'copilot', event })
}

function readEventFromStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

async function loadLocalCatalog() {
  if (typeof import.meta.resolve !== 'function') return undefined

  let catalogUrl
  try {
    catalogUrl = import.meta.resolve('@tanstack/intent/catalog')
  } catch {
    return undefined
  }

  try {
    return await import(catalogUrl)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && error?.url === catalogUrl)
      return undefined
    throw error
  }
}

function runFallback(root) {
  const result = JSON.parse(
    execFileSync(CATALOG_COMMAND, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, INTENT_AUDIENCE: 'agent' },
      maxBuffer: 1024 * 1024,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 9000,
    }),
  )
  if (typeof result.context !== 'string' || result.context.length === 0) return

  console.error(
    \`[intent catalog] SessionStart \${result.cacheStatus ?? 'unknown'}; \${result.skillCount ?? 0} skills; \${result.sizeBytes ?? Buffer.byteLength(result.context)} bytes; \${formatDuration(result.durationMs)}; packageJsonReadCount=\${result.packageJsonReadCount ?? 0}; fallback=true\`,
  )
  process.stdout.write(JSON.stringify({ additionalContext: result.context }))
}

function formatDuration(value) {
  return typeof value === 'number' ? \`\${value.toFixed(1)}ms\` : 'unknown'
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
  const adapter = HOOK_AGENT_ADAPTERS[agent]
  if (!adapter.supportedScopes.has(scope)) {
    return {
      agent,
      configPath: null,
      reason: `${scope} scope is not supported`,
      scope,
      scriptPath: null,
      status: 'skipped',
    }
  }

  const { configPath, scriptPath } = adapter.paths(scope, {
    copilotHome: copilotHome ?? process.env.COPILOT_HOME,
    homeDir,
    root,
  })
  const catalogCommand = formatIntentCommand(
    detectPackageManager(root),
    'catalog --json',
  ).replace('@tanstack/intent@latest', `@tanstack/intent@${intentVersion()}`)
  const scriptStatus = writeIfChanged(
    scriptPath,
    agent === 'copilot' && scope === 'project'
      ? buildCopilotProjectRunnerScript(catalogCommand)
      : buildHookRunnerScript(agent, catalogCommand),
  )
  const configStatus = updateJsonConfig(configPath, (config) =>
    upsertAdapterHooks({
      config,
      configKind: adapter.configKind,
      project: scope === 'project',
      scriptPath,
    }),
  )

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

function upsertAdapterHooks({
  config,
  configKind,
  project,
  scriptPath,
}: {
  config: Record<string, unknown>
  configKind: (typeof HOOK_AGENT_ADAPTERS)[HookAgent]['configKind']
  project: boolean
  scriptPath: string
}): Record<string, unknown> {
  switch (configKind) {
    case 'claude-settings':
      return upsertClaudeHooks(config, project, scriptPath)
    case 'codex-hooks':
      return upsertCodexHooks(config, project, scriptPath)
    case 'copilot-hooks':
      return upsertCopilotHooks(config, project, scriptPath)
  }
}

function upsertClaudeHooks(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  const handler = {
    type: 'command',
    command: 'node',
    args: [
      project
        ? '${CLAUDE_PROJECT_DIR}/.intent/hooks/intent-claude-catalog.mjs'
        : scriptPath,
    ],
    timeout: 10,
    statusMessage: CATALOG_STATUS_MESSAGE,
  }
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    matcher: 'startup|resume|clear|compact',
    hooks: [handler],
  })
  hooks.SubagentStart = upsertHookGroup(arrayValue(hooks.SubagentStart), {
    hooks: [handler],
  })
  hooks.PreToolUse = removeIntentHooks(arrayValue(hooks.PreToolUse))
  return { ...config, hooks }
}

function upsertCodexHooks(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  const command = project
    ? 'node "$(git rev-parse --show-toplevel)/.intent/hooks/intent-codex-catalog.mjs"'
    : `node ${quoteCommandPath(scriptPath)}`
  const handler = {
    type: 'command',
    command,
    commandWindows: command,
    timeout: 10,
    statusMessage: CATALOG_STATUS_MESSAGE,
  }
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    matcher: 'startup|resume|clear|compact',
    hooks: [handler],
  })
  hooks.SubagentStart = upsertHookGroup(arrayValue(hooks.SubagentStart), {
    hooks: [handler],
  })
  hooks.PreToolUse = removeIntentHooks(arrayValue(hooks.PreToolUse))
  return { ...config, hooks }
}

function upsertCopilotHooks(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  const handler = {
    type: 'command',
    command: project
      ? 'node .intent/hooks/intent-copilot-catalog.mjs'
      : `node ${quoteCommandPath(scriptPath)}`,
    ...(project ? { cwd: '.' } : {}),
    timeoutSec: 10,
  }
  hooks.sessionStart = upsertHookGroup(arrayValue(hooks.sessionStart), handler)
  hooks.subagentStart = upsertHookGroup(
    arrayValue(hooks.subagentStart),
    handler,
  )
  hooks.SessionStart = removeIntentHooks(arrayValue(hooks.SessionStart))
  hooks.SubagentStart = removeIntentHooks(arrayValue(hooks.SubagentStart))
  hooks.PreToolUse = removeIntentHooks(arrayValue(hooks.PreToolUse))
  return { ...config, version: 1, hooks }
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
  return [command, ...args].some((candidate) =>
    /(?:^|[\s"'/])(?:old-)?intent-(claude|codex|copilot)-(?:gate|catalog)\.mjs(?:$|[?#\s"'])/i.test(
      candidate,
    ),
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
  if (current === next) return 'unchanged'
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, next)
  return existed ? 'updated' : 'created'
}

function writeIfChanged(filePath: string, content: string): HookInstallStatus {
  const existed = existsSync(filePath)
  if (existed && readFileSync(filePath, 'utf8') === content) return 'unchanged'
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return existed ? 'updated' : 'created'
}

function parseAgents(value: string | undefined): Array<HookAgent> {
  if (!value || value === 'all') return ALL_HOOK_AGENTS
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
  } catch (error) {
    fail(
      `Failed to parse ${formatPath(filePath)}: ${error instanceof Error ? error.message : String(error)}`,
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

function quoteCommandPath(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function formatPath(filePath: string): string {
  return relative(process.cwd(), filePath) || filePath
}

function intentVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  let previous: string | undefined
  while (directory !== previous) {
    let packageJson: { name?: unknown; version?: unknown } | undefined
    try {
      packageJson = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8'),
      ) as { name?: unknown; version?: unknown }
    } catch {
      packageJson = undefined
    }
    if (
      packageJson?.name === '@tanstack/intent' &&
      typeof packageJson.version === 'string'
    ) {
      return packageJson.version
    }
    previous = directory
    directory = dirname(directory)
  }
  return 'latest'
}
