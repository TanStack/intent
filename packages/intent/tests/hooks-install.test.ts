import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { HOOK_AGENT_ADAPTERS } from '../src/hooks/adapters.js'
import {
  buildCopilotProjectRunnerScript,
  buildHookRunnerScript,
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
  it('supports verified project and user scopes for all hook agents', () => {
    for (const adapter of Object.values(HOOK_AGENT_ADAPTERS)) {
      expect(adapter.supportedScopes.has('project')).toBe(true)
      expect(adapter.supportedScopes.has('user')).toBe(true)
    }
  })

  it('installs session and subagent catalogue hooks without an edit gate', () => {
    const root = tempRoot('intent-hooks-project-')

    const results = runInstallHooks({ root, scope: 'project' })

    expect(results.every((result) => result.status === 'created')).toBe(true)

    const claude = readJson(join(root, '.claude', 'settings.json'))
    expect(claude.hooks.SessionStart[0].matcher).toBe(
      'startup|resume|clear|compact',
    )
    expect(claude.hooks.SubagentStart).toHaveLength(1)
    expect(claude.hooks.PreToolUse).toEqual([])
    expect(claude.hooks.SessionStart[0].hooks[0]).toMatchObject({
      command: 'node',
      args: ['${CLAUDE_PROJECT_DIR}/.intent/hooks/intent-claude-catalog.mjs'],
      type: 'command',
    })

    const codex = readJson(join(root, '.codex', 'hooks.json'))
    expect(codex.hooks.SessionStart[0].matcher).toBe(
      'startup|resume|clear|compact',
    )
    expect(codex.hooks.SubagentStart).toHaveLength(1)
    expect(codex.hooks.PreToolUse).toEqual([])
    expect(codex.hooks.SessionStart[0].hooks[0].command).toContain(
      'git rev-parse --show-toplevel',
    )

    const copilot = readJson(join(root, '.github', 'hooks', 'intent.json'))
    expect(copilot.version).toBe(1)
    expect(copilot.hooks.sessionStart).toHaveLength(1)
    expect(copilot.hooks.subagentStart).toHaveLength(1)
    expect(copilot.hooks.PreToolUse).toEqual([])
    expect(copilot.hooks.sessionStart[0]).toMatchObject({
      command: 'node .intent/hooks/intent-copilot-catalog.mjs',
      cwd: '.',
      timeoutSec: 10,
      type: 'command',
    })
  })

  it('installs user-scoped Copilot hooks under COPILOT_HOME', () => {
    const root = tempRoot('intent-hooks-user-root-')
    const homeDir = tempRoot('intent-hooks-user-home-')
    const copilotHome = join(homeDir, '.custom-copilot')

    const [result] = runInstallHooks({
      agents: 'copilot',
      copilotHome,
      homeDir,
      root,
      scope: 'user',
    })

    expect(result).toMatchObject({ status: 'created' })
    const config = readJson(join(copilotHome, 'hooks', 'hooks.json'))
    expect(config.hooks.sessionStart[0].command).toContain(
      'intent-copilot-catalog.mjs',
    )
    expect(result?.scriptPath).toContain(join(homeDir, '.tanstack'))
  })

  it('runs a compatible workspace catalogue API without invoking fallback', () => {
    const root = tempRoot('intent-hooks-copilot-local-api-')
    const localMarker = join(root, 'local-api.txt')
    const fallbackMarker = join(root, 'fallback.txt')
    const fallbackCommand = writeFallbackCatalogCommand(root, fallbackMarker)
    writeCatalogApiPackage(
      root,
      `import { writeFileSync } from 'node:fs'
export async function runSessionCatalogueHook({ agent }) {
  writeFileSync(${JSON.stringify(localMarker)}, agent)
  process.stdout.write(JSON.stringify({ additionalContext: 'local API context' }))
}
`,
    )
    const scriptPath = join(root, 'intent-copilot-catalog.mjs')
    writeFileSync(scriptPath, buildCopilotProjectRunnerScript(fallbackCommand))

    const result = runHookScript(scriptPath, sessionEvent('copilot', root))

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      additionalContext: 'local API context',
    })
    expect(readFileSync(localMarker, 'utf8')).toBe('copilot')
    expect(existsSync(fallbackMarker)).toBe(false)
  })

  it('uses fallback when the workspace package lacks the catalogue export', () => {
    const root = tempRoot('intent-hooks-copilot-old-package-')
    const fallbackMarker = join(root, 'fallback.txt')
    const fallbackCommand = writeFallbackCatalogCommand(root, fallbackMarker)
    const packageDir = join(root, 'node_modules', '@tanstack', 'intent')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@tanstack/intent', type: 'module' }),
    )
    const scriptPath = join(root, 'intent-copilot-catalog.mjs')
    writeFileSync(scriptPath, buildCopilotProjectRunnerScript(fallbackCommand))

    const result = runHookScript(scriptPath, sessionEvent('copilot', root))

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      additionalContext: expect.stringContaining('fallback skill'),
    })
    expect(readFileSync(fallbackMarker, 'utf8')).toBe(root)
  })

  it('uses fallback when the workspace catalogue export target is missing', () => {
    const root = tempRoot('intent-hooks-copilot-missing-export-target-')
    const fallbackMarker = join(root, 'fallback.txt')
    const fallbackCommand = writeFallbackCatalogCommand(root, fallbackMarker)
    const packageDir = join(root, 'node_modules', '@tanstack', 'intent')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@tanstack/intent',
        type: 'module',
        exports: { './catalog': './missing-catalog.mjs' },
      }),
    )
    const scriptPath = join(root, 'intent-copilot-catalog.mjs')
    writeFileSync(scriptPath, buildCopilotProjectRunnerScript(fallbackCommand))

    const result = runHookScript(scriptPath, sessionEvent('copilot', root))

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      additionalContext: expect.stringContaining('fallback skill'),
    })
    expect(readFileSync(fallbackMarker, 'utf8')).toBe(root)
  })

  it('fails open without fallback when the resolved catalogue API throws', () => {
    const root = tempRoot('intent-hooks-copilot-runtime-failure-')
    const fallbackMarker = join(root, 'fallback.txt')
    const fallbackCommand = writeFallbackCatalogCommand(root, fallbackMarker)
    writeCatalogApiPackage(
      root,
      `export async function runSessionCatalogueHook() {
  throw new Error('runtime failure')
}
`,
    )
    const scriptPath = join(root, 'intent-copilot-catalog.mjs')
    writeFileSync(scriptPath, buildCopilotProjectRunnerScript(fallbackCommand))

    const result = runHookScript(scriptPath, sessionEvent('copilot', root))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('hook failed open: runtime failure')
    expect(existsSync(fallbackMarker)).toBe(false)
  })

  it('fails open without fallback when the local catalogue has a missing dependency', () => {
    const root = tempRoot('intent-hooks-copilot-missing-dependency-')
    const fallbackMarker = join(root, 'fallback.txt')
    const fallbackCommand = writeFallbackCatalogCommand(root, fallbackMarker)
    writeCatalogApiPackage(
      root,
      `import 'missing-catalog-dependency'
export async function runSessionCatalogueHook() {}
`,
    )
    const scriptPath = join(root, 'intent-copilot-catalog.mjs')
    writeFileSync(scriptPath, buildCopilotProjectRunnerScript(fallbackCommand))

    const result = runHookScript(scriptPath, sessionEvent('copilot', root))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('hook failed open:')
    expect(result.stderr).toContain('missing-catalog-dependency')
    expect(existsSync(fallbackMarker)).toBe(false)
  })

  it('fails open without fallback when a catalogue dependency blocks a subpath', () => {
    const root = tempRoot('intent-hooks-copilot-blocked-subpath-')
    const fallbackMarker = join(root, 'fallback.txt')
    const fallbackCommand = writeFallbackCatalogCommand(root, fallbackMarker)
    writeCatalogApiPackage(
      root,
      `import 'blocked-catalog-dependency/private'
export async function runSessionCatalogueHook() {}
`,
    )
    const dependencyDir = join(
      root,
      'node_modules',
      'blocked-catalog-dependency',
    )
    mkdirSync(dependencyDir, { recursive: true })
    writeFileSync(
      join(dependencyDir, 'package.json'),
      JSON.stringify({
        name: 'blocked-catalog-dependency',
        type: 'module',
        exports: { '.': './index.mjs' },
      }),
    )
    writeFileSync(join(dependencyDir, 'index.mjs'), '')
    const scriptPath = join(root, 'intent-copilot-catalog.mjs')
    writeFileSync(scriptPath, buildCopilotProjectRunnerScript(fallbackCommand))

    const result = runHookScript(scriptPath, sessionEvent('copilot', root))

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('hook failed open:')
    expect(result.stderr).toContain('blocked-catalog-dependency')
    expect(existsSync(fallbackMarker)).toBe(false)
  })

  it('preserves unrelated hooks and replaces old Intent gate entries', () => {
    const root = tempRoot('intent-hooks-upgrade-')
    const settingsPath = join(root, '.claude', 'settings.json')
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Edit',
              hooks: [
                { type: 'command', command: 'node old-intent-claude-gate.mjs' },
                { type: 'command', command: 'echo keep' },
              ],
            },
          ],
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'echo session-keep' }],
            },
          ],
        },
      }),
    )

    runInstallHooks({ agents: 'claude', root, scope: 'project' })
    const second = runInstallHooks({
      agents: 'claude',
      root,
      scope: 'project',
    })

    const config = readJson(settingsPath)
    expect(config.hooks.PreToolUse).toEqual([
      {
        matcher: 'Edit',
        hooks: [{ type: 'command', command: 'echo keep' }],
      },
    ])
    expect(config.hooks.SessionStart).toHaveLength(2)
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe(
      'echo session-keep',
    )
    expect(second[0]).toMatchObject({ status: 'unchanged' })
  })

  it.each(['claude', 'codex', 'copilot'] as const)(
    'emits compact session catalogue context for %s',
    (agent) => {
      const root = tempRoot(`intent-hooks-session-${agent}-`)
      const catalogCommand = writeFakeCatalogCommand(root)
      const scriptPath = join(root, `intent-${agent}-catalog.mjs`)
      writeFileSync(scriptPath, buildHookRunnerScript(agent, catalogCommand))

      const result = runHookScript(scriptPath, sessionEvent(agent, root))

      expect(result.status).toBe(0)
      expect(result.stderr).toContain('[intent catalog] SessionStart hit')
      const output = JSON.parse(result.stdout)
      const context =
        agent === 'copilot'
          ? output.additionalContext
          : output.hookSpecificOutput.additionalContext
      expect(context).toContain('TanStack Intent: 1 available skill')
      expect(context).toContain('@tanstack/router#routing')
      expect(context).toContain('Do not run `intent list`')
    },
  )

  it.each(['claude', 'codex', 'copilot'] as const)(
    'injects the same catalogue into %s subagents',
    (agent) => {
      const root = tempRoot(`intent-hooks-subagent-${agent}-`)
      const catalogCommand = writeFakeCatalogCommand(root)
      const scriptPath = join(root, `intent-${agent}-catalog.mjs`)
      writeFileSync(scriptPath, buildHookRunnerScript(agent, catalogCommand))

      const event =
        agent === 'copilot'
          ? { agentName: 'researcher', cwd: root, sessionId: 'session-a' }
          : {
              agent_type: 'researcher',
              cwd: root,
              hook_event_name: 'SubagentStart',
              session_id: 'session-a',
            }
      const result = runHookScript(scriptPath, event)
      const output = JSON.parse(result.stdout)

      expect(result.status).toBe(0)
      expect(
        agent === 'copilot'
          ? output.additionalContext
          : output.hookSpecificOutput.additionalContext,
      ).toContain('@tanstack/router#routing')
      if (agent !== 'copilot') {
        expect(output.hookSpecificOutput.hookEventName).toBe('SubagentStart')
      }
    },
  )

  it('does not emit context for non-lifecycle events or block edits', () => {
    const root = tempRoot('intent-hooks-advisory-')
    const scriptPath = join(root, 'intent-claude-catalog.mjs')
    writeFileSync(
      scriptPath,
      buildHookRunnerScript('claude', writeFakeCatalogCommand(root)),
    )

    const result = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: 'session-a',
      tool_name: 'Edit',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('respects a nested event cwd and fails open on catalogue errors', () => {
    const root = tempRoot('intent-hooks-nested-')
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    const markerPath = join(root, 'cwd.txt')
    const catalogCommand = writeFakeCatalogCommand(root, markerPath)
    const scriptPath = join(root, 'intent-claude-catalog.mjs')
    writeFileSync(scriptPath, buildHookRunnerScript('claude', catalogCommand))

    const nestedResult = runHookScript(scriptPath, {
      cwd: nested,
      hook_event_name: 'SessionStart',
      session_id: 'session-a',
      source: 'resume',
    })
    expect(nestedResult.status).toBe(0)
    expect(readFileSync(markerPath, 'utf8')).toBe(realpathSync.native(nested))

    const failingPath = join(root, 'failing-catalog.mjs')
    writeFileSync(failingPath, 'process.exit(1)\n')
    writeFileSync(
      scriptPath,
      buildHookRunnerScript(
        'claude',
        `${quoteCommandPath(process.execPath)} ${quoteCommandPath(failingPath)}`,
      ),
    )
    const failed = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'SessionStart',
      session_id: 'session-a',
    })

    expect(failed.status).toBe(0)
    expect(failed.stdout).toBe('')
    expect(failed.stderr).toContain('hook failed open')
  })

  it('falls back when a workspace-local Intent CLI lacks catalog support', () => {
    const root = tempRoot('intent-hooks-old-local-cli-')
    const localCli = join(
      root,
      'node_modules',
      '@tanstack',
      'intent',
      'dist',
      'cli.mjs',
    )
    mkdirSync(join(root, 'node_modules', '@tanstack', 'intent', 'dist'), {
      recursive: true,
    })
    writeFileSync(localCli, 'process.exit(1)\n')
    const scriptPath = join(root, 'intent-claude-catalog.mjs')
    writeFileSync(
      scriptPath,
      buildHookRunnerScript('claude', writeFakeCatalogCommand(root)),
    )

    const result = runHookScript(scriptPath, {
      cwd: root,
      hook_event_name: 'SessionStart',
      session_id: 'session-a',
    })

    expect(result.status).toBe(0)
    expect(
      JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    ).toContain('@tanstack/router#routing')
  })
})

function runHookScript(scriptPath: string, event: Record<string, unknown>) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    input: JSON.stringify(event),
  })
}

function sessionEvent(agent: string, root: string): Record<string, unknown> {
  return agent === 'copilot'
    ? { cwd: root, sessionId: 'session-a', source: 'startup' }
    : {
        cwd: root,
        hook_event_name: 'SessionStart',
        session_id: 'session-a',
        source: 'startup',
      }
}

function writeFakeCatalogCommand(root: string, markerPath?: string): string {
  const scriptPath = join(
    root,
    `fake-catalog-${markerPath ? 'marked' : 'plain'}.mjs`,
  )
  const context =
    'TanStack Intent: 1 available skill.\n\n- @tanstack/router#routing: Router routing guidance\n\nDo not run `intent list`; this catalogue is already current for the workspace.'
  writeFileSync(
    scriptPath,
    `${markerPath ? `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(markerPath)}, process.cwd())\n` : ''}console.log(JSON.stringify({
  cacheStatus: 'hit',
  context: ${JSON.stringify(context)},
  durationMs: 1.2,
  packageJsonReadCount: 0,
  sizeBytes: 180,
  skillCount: 1
}))\n`,
  )
  return `${quoteCommandPath(process.execPath)} ${quoteCommandPath(scriptPath)}`
}

function writeCatalogApiPackage(root: string, source: string): void {
  const packageDir = join(root, 'node_modules', '@tanstack', 'intent')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: '@tanstack/intent',
      type: 'module',
      exports: { './catalog': './catalog.mjs' },
    }),
  )
  writeFileSync(join(packageDir, 'catalog.mjs'), source)
}

function writeFallbackCatalogCommand(root: string, markerPath: string): string {
  const scriptPath = join(root, 'fallback-catalog.mjs')
  writeFileSync(
    scriptPath,
    `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(markerPath)}, process.cwd())
console.log(JSON.stringify({
  cacheStatus: 'hit',
  context: 'TanStack Intent: 1 available skill.\\n\\n- pkg#fallback: fallback skill',
  durationMs: 1,
  packageJsonReadCount: 0,
  sizeBytes: 80,
  skillCount: 1
}))
`,
  )
  return `${quoteCommandPath(process.execPath)} ${quoteCommandPath(scriptPath)}`
}

function quoteCommandPath(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}
