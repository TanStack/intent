import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { HOOK_AGENT_ADAPTERS } from '../src/hooks/adapters.js'
import {
  buildHookRunnerScript,
  formatHookInstallResult,
  runInstallHooks,
} from '../src/hooks/install.js'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  tempDirs.push(root)
  return root
}

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any>
}

describe('hook installer', () => {
  it('declares supported scopes in the adapter registry', () => {
    expect(HOOK_AGENT_ADAPTERS.claude.supportedScopes.has('project')).toBe(true)
    expect(HOOK_AGENT_ADAPTERS.codex.supportedScopes.has('project')).toBe(true)
    expect(HOOK_AGENT_ADAPTERS.copilot.supportedScopes.has('project')).toBe(
      false,
    )
    expect(HOOK_AGENT_ADAPTERS.copilot.supportedScopes.has('user')).toBe(true)
  })

  it('installs project-scoped Claude and Codex hooks and skips Copilot', () => {
    const root = tempRoot('intent-hooks-project-')

    const results = runInstallHooks({ root, scope: 'project' })

    expect(results.map((result) => result.agent)).toEqual([
      'copilot',
      'claude',
      'codex',
    ])
    expect(results.find((result) => result.agent === 'copilot')).toMatchObject({
      status: 'skipped',
      reason: 'project scope is not supported; use --scope user',
    })
    expect(results.find((result) => result.agent === 'claude')).toMatchObject({
      status: 'created',
      scope: 'project',
    })
    expect(results.find((result) => result.agent === 'codex')).toMatchObject({
      status: 'created',
      scope: 'project',
    })

    const claudeConfig = readJson(join(root, '.claude', 'settings.json'))
    expect(claudeConfig.hooks.SessionStart).toHaveLength(1)
    expect(claudeConfig.hooks.SessionStart[0].matcher).toBe(
      'startup|resume|clear|compact',
    )
    expect(claudeConfig.hooks.SessionStart[0].hooks[0]).toMatchObject({
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.intent/hooks/intent-claude-gate.mjs'],
      type: 'command',
    })
    expect(claudeConfig.hooks.PreToolUse).toHaveLength(1)
    expect(claudeConfig.hooks.PreToolUse[0].matcher).toBe(
      'Bash|Write|Edit|MultiEdit|NotebookEdit',
    )
    expect(claudeConfig.hooks.PreToolUse[0].hooks[0]).toMatchObject({
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.intent/hooks/intent-claude-gate.mjs'],
      type: 'command',
    })

    const codexConfig = readJson(join(root, '.codex', 'hooks.json'))
    expect(codexConfig.hooks.SessionStart[0].matcher).toBe(
      'startup|resume|clear|compact',
    )
    expect(codexConfig.hooks.SessionStart[0].hooks[0].command).toContain(
      '.intent/hooks/intent-codex-gate.mjs',
    )
    expect(codexConfig.hooks.PreToolUse[0].matcher).toBe(
      'Bash|apply_patch|Edit|Write',
    )
    expect(codexConfig.hooks.PreToolUse[0].hooks[0].command).toContain(
      '.intent/hooks/intent-codex-gate.mjs',
    )
    expect(
      existsSync(join(root, '.intent', 'hooks', 'intent-claude-gate.mjs')),
    ).toBe(true)
    expect(
      existsSync(join(root, '.intent', 'hooks', 'intent-codex-gate.mjs')),
    ).toBe(true)
  })

  it('installs user-scoped Copilot hooks into the selected home', () => {
    const root = tempRoot('intent-hooks-root-')
    const homeDir = tempRoot('intent-hooks-home-')
    const copilotHome = join(homeDir, '.custom-copilot')

    const [result] = runInstallHooks({
      agents: 'copilot',
      copilotHome,
      homeDir,
      root,
      scope: 'user',
    })

    expect(result).toMatchObject({ agent: 'copilot', status: 'created' })
    const config = readJson(join(copilotHome, 'hooks', 'hooks.json'))
    const sessionCommand = config.hooks.SessionStart[0].command as string
    const command = config.hooks.PreToolUse[0].command as string

    expect(sessionCommand).toContain(join(homeDir, '.tanstack'))
    expect(sessionCommand).toContain('intent-copilot-gate.mjs')
    expect(command).toContain(join(homeDir, '.tanstack'))
    expect(command).toContain('intent-copilot-gate.mjs')
    expect(
      existsSync(
        join(
          homeDir,
          '.tanstack',
          'intent',
          'hooks',
          'intent-copilot-gate.mjs',
        ),
      ),
    ).toBe(true)
  })

  it('updates only the Intent hook group on repeated installs', () => {
    const root = tempRoot('intent-hooks-update-')
    const settingsPath = join(root, '.claude', 'settings.json')
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'echo keep' }],
              },
              {
                matcher: 'Edit',
                hooks: [
                  {
                    type: 'command',
                    command: 'node old-intent-claude-gate.mjs',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    )

    runInstallHooks({ agents: 'claude', root, scope: 'project' })
    const second = runInstallHooks({ agents: 'claude', root, scope: 'project' })

    const config = readJson(settingsPath)
    expect(config.hooks.SessionStart).toHaveLength(1)
    expect(config.hooks.PreToolUse).toHaveLength(2)
    expect(config.hooks.PreToolUse[0].hooks[0].command).toBe('echo keep')
    expect(second[0]).toMatchObject({ status: 'unchanged' })
  })

  it('preserves sibling hooks when replacing an Intent hook entry', () => {
    const root = tempRoot('intent-hooks-sibling-')
    const settingsPath = join(root, '.claude', 'settings.json')
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit',
                hooks: [
                  {
                    type: 'command',
                    command: 'node old-intent-claude-gate.mjs',
                  },
                  { type: 'command', command: 'echo keep' },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    )

    runInstallHooks({ agents: 'claude', root, scope: 'project' })

    const config = readJson(settingsPath)
    expect(config.hooks.SessionStart).toHaveLength(1)
    expect(config.hooks.PreToolUse).toHaveLength(2)
    expect(config.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: 'echo keep' },
    ])
    expect(config.hooks.PreToolUse[1].hooks[0].args[0]).toContain(
      'intent-claude-gate.mjs',
    )
  })

  it('replaces direct Copilot Intent hook entries on reinstall', () => {
    const root = tempRoot('intent-hooks-copilot-replace-root-')
    const homeDir = tempRoot('intent-hooks-copilot-replace-home-')
    const copilotHome = join(homeDir, '.copilot')
    const hooksPath = join(copilotHome, 'hooks', 'hooks.json')
    mkdirSync(join(copilotHome, 'hooks'), { recursive: true })
    writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { command: 'node /tmp/old-intent-copilot-gate.mjs' },
              { command: 'echo keep' },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    )

    runInstallHooks({
      agents: 'copilot',
      copilotHome,
      homeDir,
      root,
      scope: 'user',
    })

    const config = readJson(hooksPath)
    expect(config.hooks.SessionStart).toHaveLength(1)
    expect(config.hooks.PreToolUse).toHaveLength(2)
    expect(config.hooks.PreToolUse[0]).toEqual({ command: 'echo keep' })
    expect(config.hooks.PreToolUse[1].command).toContain(
      'intent-copilot-gate.mjs',
    )
  })

  it('preserves hooks that only mention an Intent gate outside command fields', () => {
    const root = tempRoot('intent-hooks-copilot-preserve-root-')
    const homeDir = tempRoot('intent-hooks-copilot-preserve-home-')
    const copilotHome = join(homeDir, '.copilot')
    const hooksPath = join(copilotHome, 'hooks', 'hooks.json')
    mkdirSync(join(copilotHome, 'hooks'), { recursive: true })
    writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                command: 'echo keep',
                note: 'mentions intent-copilot-gate.mjs in documentation',
              },
              { command: 'node /tmp/old-intent-copilot-gate.mjs' },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    )

    runInstallHooks({
      agents: 'copilot',
      copilotHome,
      homeDir,
      root,
      scope: 'user',
    })

    const config = readJson(hooksPath)
    expect(config.hooks.SessionStart).toHaveLength(1)
    expect(config.hooks.PreToolUse).toHaveLength(2)
    expect(config.hooks.PreToolUse[0]).toMatchObject({
      command: 'echo keep',
      note: 'mentions intent-copilot-gate.mjs in documentation',
    })
    expect(config.hooks.PreToolUse[1].command).toContain(
      'intent-copilot-gate.mjs',
    )
  })

  it('builds a runner script with command-free denial text', () => {
    const script = buildHookRunnerScript('claude')

    expect(script).toContain('const AGENT = "claude"')
    expect(script).toContain('permissionDecision')
    expect(script).not.toMatch(/Blocked:.*intent\s+(list|load)/i)
    expect(script).not.toContain('@tanstack/intent/core')
    expect(script).not.toContain('createRequire')
  })

  it('runs the generated gate script through the load then edit cycle', () => {
    const root = tempRoot('intent-hooks-runner-')
    const scriptPath = join(root, 'intent-claude-gate.mjs')
    writeFileSync(scriptPath, buildHookRunnerScript('claude'))

    const beforeLoad = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src.ts') },
    })
    const load = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Bash',
      tool_input: { command: 'intent load @tanstack/router#routing' },
    })
    const afterLoad = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src.ts') },
    })

    expect(beforeLoad.status).toBe(0)
    expect(JSON.parse(beforeLoad.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    })
    expect(load.status).toBe(0)
    expect(load.stdout).toBe('')
    expect(afterLoad.status).toBe(0)
    expect(afterLoad.stdout).toBe('')
  })

  it.each(['claude', 'codex', 'copilot'] as const)(
    'emits session catalog context for %s',
    (agent) => {
      const root = tempRoot(`intent-hooks-session-catalog-${agent}-`)
      const catalogCommand = writeFakeIntentListCommand(root)
      const scriptPath = join(
        root,
        '.intent',
        'hooks',
        `intent-${agent}-gate.mjs`,
      )
      mkdirSync(join(root, '.intent', 'hooks'), { recursive: true })
      writeFileSync(scriptPath, buildHookRunnerScript(agent, catalogCommand))

      const result = runHookScript(scriptPath, {
        cwd: root,
        hook_event_name: 'SessionStart',
        session_id: 'session-a',
        source: 'startup',
      })

      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout) as any
      const context =
        agent === 'copilot'
          ? output.additionalContext
          : output.hookSpecificOutput.additionalContext
      expect(context).toContain('TanStack Intent skills are available')
      expect(context).toContain(
        '- @tanstack/router#routing: Router routing guidance',
      )
      expect(context).toContain('load that full skill guidance')
      expect(context).not.toContain('intent load <skill-id>')
      if (agent !== 'copilot') {
        expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart')
      }
    },
  )

  it('does not unlock edits after session catalog context', () => {
    const root = tempRoot('intent-hooks-session-catalog-gate-')
    const catalogCommand = writeFakeIntentListCommand(root)
    const scriptPath = join(root, '.intent', 'hooks', 'intent-claude-gate.mjs')
    mkdirSync(join(root, '.intent', 'hooks'), { recursive: true })
    writeFileSync(scriptPath, buildHookRunnerScript('claude', catalogCommand))

    const sessionStart = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'SessionStart',
      session_id: 'session-a',
      source: 'startup',
    })
    const edit = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src.ts') },
    })

    expect(sessionStart.status).toBe(0)
    expect(JSON.parse(sessionStart.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    })
    expect(edit.status).toBe(0)
    expect(JSON.parse(edit.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    })
  })

  it('continues silently when session catalog loading fails', () => {
    const root = tempRoot('intent-hooks-session-catalog-missing-')
    const scriptPath = join(root, '.intent', 'hooks', 'intent-claude-gate.mjs')
    mkdirSync(join(root, '.intent', 'hooks'), { recursive: true })
    writeFileSync(
      scriptPath,
      buildHookRunnerScript(
        'claude',
        `${quoteShell(process.execPath)} ${quoteShell(join(root, 'missing.mjs'))}`,
      ),
    )

    const result = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'SessionStart',
      session_id: 'session-a',
      source: 'startup',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('does not unlock edits after non-executed load text', () => {
    const root = tempRoot('intent-hooks-non-executed-load-')
    const scriptPath = join(root, 'intent-claude-gate.mjs')
    writeFileSync(scriptPath, buildHookRunnerScript('claude'))

    const echoLoad = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Bash',
      tool_input: { command: 'echo intent load @tanstack/router#routing' },
    })
    const afterEcho = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src.ts') },
    })

    expect(echoLoad.status).toBe(0)
    expect(echoLoad.stdout).toBe('')
    expect(afterEcho.status).toBe(0)
    expect(JSON.parse(afterEcho.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    })
  })

  it('unlocks edits after a load in an or-chain command', () => {
    const root = tempRoot('intent-hooks-runner-or-chain-')
    const scriptPath = join(root, 'intent-claude-gate.mjs')
    writeFileSync(scriptPath, buildHookRunnerScript('claude'))

    const load = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test || intent load @tanstack/router#routing',
      },
    })
    const afterLoad = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src.ts') },
    })

    expect(load.status).toBe(0)
    expect(load.stdout).toBe('')
    expect(afterLoad.status).toBe(0)
    expect(afterLoad.stdout).toBe('')
  })

  it('formats skipped install results', () => {
    expect(
      formatHookInstallResult({
        agent: 'copilot',
        configPath: null,
        reason: 'project scope is not supported; use --scope user',
        scope: 'project',
        scriptPath: null,
        status: 'skipped',
      }),
    ).toBe(
      'Skipped Intent hooks for copilot: project scope is not supported; use --scope user',
    )
  })
})

function runHookScript(scriptPath: string, event: Record<string, unknown>) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    input: JSON.stringify(event),
  })
}

function writeFakeIntentListCommand(root: string): string {
  const scriptPath = join(root, 'fake-intent-list.mjs')
  writeFileSync(
    scriptPath,
    `if (process.env.INTENT_AUDIENCE !== 'agent') {
  process.exit(1)
}

console.log(JSON.stringify({
    conflicts: [],
    debug: { scan: { packageJsonReadCount: 3 } },
    packages: [{ name: '@tanstack/router' }],
    skills: [
      {
        description: 'Router routing guidance',
        use: '@tanstack/router#routing',
      },
    ],
    warnings: [],
  }))
`,
  )
  return `${quoteShell(process.execPath)} ${quoteShell(scriptPath)}`
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
