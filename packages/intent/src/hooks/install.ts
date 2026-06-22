import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, relative } from 'node:path'
import { detectPackageManager } from '../discovery/package-manager.js'
import { fail } from '../shared/cli-error.js'
import { formatIntentCommand } from '../shared/command-runner.js'
import { ALL_HOOK_AGENTS, HOOK_AGENT_ADAPTERS } from './adapters.js'
import { EDIT_TOOLS_BY_AGENT, GATE_DENY_REASON } from './policy.js'
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

const GATE_STATUS_MESSAGE = 'Checking Intent guidance'
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
    'list --json --no-notices',
  ),
): string {
  const editTools = [...EDIT_TOOLS_BY_AGENT[agent]].sort()

  return `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const AGENT = ${JSON.stringify(agent)}
const CATALOG_COMMAND = ${JSON.stringify(catalogCommand)}
const EDIT_TOOLS = new Set(${JSON.stringify(editTools)})
const GATE_DENY_REASON = ${JSON.stringify(GATE_DENY_REASON)}
const INTENT_COMMAND_PATTERN = /(?:^|&&|\\|\\||;|\\|)\\s*((?:bunx\\s+@tanstack\\/intent(?:@latest)?)|(?:pnpm\\s+exec\\s+intent)|(?:pnpm\\s+dlx\\s+@tanstack\\/intent(?:@latest)?)|(?:npx\\s+@tanstack\\/intent(?:@latest)?)|(?:yarn\\s+dlx\\s+@tanstack\\/intent(?:@latest)?)|(?:intent))\\s+(list|load)(?:\\s+([^\\s|;&]+))?/i

try {
  await main()
} catch {
}

process.exit(0)

async function main() {
  const event = readEventFromStdin()

  if (isSessionStartEvent(event)) {
    const additionalContext = await createSessionCatalogContext(rootForEvent(event))
    if (additionalContext) {
      process.stdout.write(JSON.stringify(sessionStartOutput(additionalContext)))
    }
    return
  }

  const stateFile = stateFileForEvent(event)
  const observation = observationFromEvent(event)

  if (observation) {
    appendObservation(stateFile, observation)
  }

  const toolName = event?.tool_name ?? event?.toolName
  if (typeof toolName === 'string' && EDIT_TOOLS.has(toolName) && !hasLoad(stateFile)) {
    process.stdout.write(JSON.stringify(denyOutput()))
  }
}

function readEventFromStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

function isSessionStartEvent(event) {
  return (event?.hook_event_name ?? event?.hookEventName) === 'SessionStart'
}

function rootForEvent(event) {
  return typeof event?.cwd === 'string' ? event.cwd : process.cwd()
}

async function createSessionCatalogContext(root) {
  try {
    const start = performance.now()
    const result = readIntentList(root)
    const durationMs = performance.now() - start
    console.error(
      \`[intent-\${AGENT}-session-catalog] listIntentSkills found \${result.skills.length} skills from \${result.packages.length} packages in \${formatDuration(durationMs)} (packageJsonReadCount=\${result.debug?.scan.packageJsonReadCount ?? 'unknown'})\`,
    )
    return formatSessionCatalog(result)
  } catch {
    return ''
  }
}

function readIntentList(root) {
  const output = execFileSync(CATALOG_COMMAND, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, INTENT_AUDIENCE: 'agent' },
    maxBuffer: 1024 * 1024,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 9000,
  })
  return JSON.parse(output)
}

function formatDuration(durationMs) {
  return \`\${durationMs.toFixed(1)}ms\`
}

function formatSessionCatalog(result) {
  if (!Array.isArray(result.skills) || result.skills.length === 0) return ''

  return [
    'TanStack Intent skills are available in this repository.',
    '',
    'Before substantial work, check whether one listed skill clearly matches the user task. If one clearly matches, load that full skill guidance with the Intent CLI before proceeding.',
    '',
    'If no skill clearly matches, continue normally. Do not load a skill just to improve phrasing or gather nonessential context.',
    '',
    'Available local Intent skills:',
    formatSkillCatalog(result.skills),
    formatWarnings(result),
  ]
    .filter(Boolean)
    .join('\\n')
}

function formatSkillCatalog(skills) {
  return skills
    .map((skill) => \`- \${skill.use}: \${normalizeDescription(skill.description)}\`)
    .join('\\n')
}

function normalizeDescription(description) {
  return typeof description === 'string' ? description.replace(/\\s+/g, ' ').trim() : ''
}

function formatWarnings(result) {
  const warnings = [
    ...(Array.isArray(result.warnings) ? result.warnings : []),
    ...(Array.isArray(result.conflicts)
      ? result.conflicts.map(
          (conflict) =>
            \`Version conflict for \${conflict.packageName}; using \${conflict.chosen.version}\`,
        )
      : []),
  ]

  if (warnings.length === 0) return ''
  return \`\\nWarnings:\\n\${warnings.map((warning) => \`- \${warning}\`).join('\\n')}\`
}

function sessionStartOutput(additionalContext) {
  if (AGENT === 'copilot') {
    return { additionalContext }
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
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
  const adapter = HOOK_AGENT_ADAPTERS[agent]

  if (!adapter.supportedScopes.has(scope)) {
    return {
      agent,
      configPath: null,
      reason: 'project scope is not supported; use --scope user',
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
    'list --json --no-notices',
  )
  const scriptStatus = writeIfChanged(
    scriptPath,
    buildHookRunnerScript(agent, catalogCommand),
  )
  const configStatus = updateJsonConfig(configPath, (config) =>
    upsertAdapterHooks({
      config,
      configKind: adapter.configKind,
      project: scope === 'project',
      scriptPath,
    }),
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
      return upsertCopilotHooks(config, scriptPath)
  }
}

function upsertClaudeHooks(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    matcher: 'startup|resume|clear|compact',
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
        statusMessage: CATALOG_STATUS_MESSAGE,
      },
    ],
  })
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
        statusMessage: GATE_STATUS_MESSAGE,
      },
    ],
  })
  return { ...config, hooks }
}

function upsertCodexHooks(
  config: Record<string, unknown>,
  project: boolean,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    matcher: 'startup|resume|clear|compact',
    hooks: [
      {
        type: 'command',
        command: project
          ? 'node "$(git rev-parse --show-toplevel)/.intent/hooks/intent-codex-gate.mjs"'
          : `node ${quoteShell(scriptPath)}`,
        timeout: 10,
        statusMessage: CATALOG_STATUS_MESSAGE,
      },
    ],
  })
  hooks.PreToolUse = upsertHookGroup(arrayValue(hooks.PreToolUse), {
    matcher: 'Bash|apply_patch|Edit|Write',
    hooks: [
      {
        type: 'command',
        command: project
          ? 'node "$(git rev-parse --show-toplevel)/.intent/hooks/intent-codex-gate.mjs"'
          : `node ${quoteShell(scriptPath)}`,
        timeout: 10,
        statusMessage: GATE_STATUS_MESSAGE,
      },
    ],
  })
  return { ...config, hooks }
}

function upsertCopilotHooks(
  config: Record<string, unknown>,
  scriptPath: string,
): Record<string, unknown> {
  const hooks = objectValue(config.hooks)
  hooks.SessionStart = upsertHookGroup(arrayValue(hooks.SessionStart), {
    command: `node ${quoteShell(scriptPath)}`,
  })
  hooks.PreToolUse = upsertHookGroup(arrayValue(hooks.PreToolUse), {
    command: `node ${quoteShell(scriptPath)}`,
  })
  return { ...config, hooks }
}

function upsertHookGroup(
  groups: Array<unknown>,
  nextGroup: Record<string, unknown>,
): Array<unknown> {
  return [...groups.flatMap(withoutIntentHooks), nextGroup]
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

  return [command, ...args].some(isIntentGateScriptReference)
}

function isIntentGateScriptReference(value: string): boolean {
  return /(?:^|[\s"'\/])(?:old-)?intent-(claude|codex|copilot)-gate\.mjs(?:$|[?#\s"'])/i.test(
    value,
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
