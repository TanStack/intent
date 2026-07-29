import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HOOK_AGENT_ADAPTERS } from '../src/hooks/adapters.js'
import {
  formatHookInstallResult,
  runInstallHooks,
} from '../src/hooks/install.js'
import { packageVersionToPin } from '../src/shared/command-runner.js'

const tempDirs: Array<string> = []
const packageJson = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
) as { version: string }
const intentPackagePin = packageVersionToPin(packageJson.version)

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
  it('pins stable versions to major.minor', () => {
    expect(packageVersionToPin('0.4.2')).toBe('0.4')
  })

  it('pins prerelease versions exactly', () => {
    expect(packageVersionToPin('0.4.0-next.1')).toBe('0.4.0-next.1')
  })

  it('declares supported scopes in the adapter registry', () => {
    expect(HOOK_AGENT_ADAPTERS.claude.supportedScopes.has('project')).toBe(true)
    expect(HOOK_AGENT_ADAPTERS.codex.supportedScopes.has('project')).toBe(true)
    expect(HOOK_AGENT_ADAPTERS.copilot.supportedScopes.has('project')).toBe(
      false,
    )
    expect(HOOK_AGENT_ADAPTERS.copilot.supportedScopes.has('user')).toBe(true)
  })

  it('installs project-scoped Claude and Codex catalogues without edit gates', () => {
    const root = tempRoot('intent-hooks-project-')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
    )

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
      command: `pnpm dlx @tanstack/intent@${intentPackagePin} hooks run --agent claude`,
      type: 'command',
    })
    expect(claudeConfig.hooks.PreToolUse).toEqual([])

    const codexConfig = readJson(join(root, '.codex', 'hooks.json'))
    expect(codexConfig.hooks.SessionStart[0].matcher).toBe(
      'startup|resume|clear|compact',
    )
    expect(codexConfig.hooks.SessionStart[0].hooks[0].command).toBe(
      `pnpm dlx @tanstack/intent@${intentPackagePin} hooks run --agent codex`,
    )
    expect(codexConfig.hooks.PreToolUse).toEqual([])
    expect(
      existsSync(join(root, '.intent', 'hooks', 'intent-claude-catalog.mjs')),
    ).toBe(false)
    expect(
      existsSync(join(root, '.intent', 'hooks', 'intent-codex-catalog.mjs')),
    ).toBe(false)
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

    expect(sessionCommand).toBe(
      `npx @tanstack/intent@${intentPackagePin} hooks run --agent copilot`,
    )
    expect(config.hooks.PreToolUse).toEqual([])
    expect(
      existsSync(
        join(
          homeDir,
          '.tanstack',
          'intent',
          'hooks',
          'intent-copilot-catalog.mjs',
        ),
      ),
    ).toBe(false)
  })

  it('updates only the Intent hook group and is unchanged on repeated installs', () => {
    const root = tempRoot('intent-hooks-update-')
    const settingsPath = join(root, '.claude', 'settings.json')
    const legacyScriptPath = join(
      root,
      '.intent',
      'hooks',
      'intent-claude-gate.mjs',
    )
    mkdirSync(join(root, '.claude'), { recursive: true })
    mkdirSync(join(root, '.intent', 'hooks'), { recursive: true })
    writeFileSync(legacyScriptPath, 'legacy gate')
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
    expect(config.hooks.PreToolUse).toHaveLength(1)
    expect(config.hooks.PreToolUse[0].hooks[0].command).toBe('echo keep')
    expect(existsSync(legacyScriptPath)).toBe(true)
    expect(second[0]).toMatchObject({ status: 'unchanged' })
  })

  it('preserves the mode of an existing hook config', () => {
    const root = tempRoot('intent-hooks-mode-')
    const settingsPath = join(root, '.claude', 'settings.json')
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, '{}\n', { mode: 0o600 })

    runInstallHooks({ agents: 'claude', root, scope: 'project' })

    expect(statSync(settingsPath).mode & 0o777).toBe(0o600)
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
    expect(config.hooks.PreToolUse).toHaveLength(1)
    expect(config.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: 'echo keep' },
    ])
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
    expect(config.hooks.PreToolUse).toEqual([{ command: 'echo keep' }])
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
    expect(config.hooks.PreToolUse).toHaveLength(1)
    expect(config.hooks.PreToolUse[0]).toEqual({
      command: 'echo keep',
      note: 'mentions intent-copilot-gate.mjs in documentation',
    })
  })

  it('formats skipped install results', () => {
    expect(
      formatHookInstallResult({
        agent: 'copilot',
        configPath: null,
        reason: 'project scope is not supported; use --scope user',
        scope: 'project',
        status: 'skipped',
      }),
    ).toBe(
      'Skipped Intent hooks for copilot: project scope is not supported; use --scope user',
    )
  })
})
