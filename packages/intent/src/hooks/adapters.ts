import { join } from 'node:path'
import type { HookAgent, HookInstallScope } from './types.js'

type HookAdapterPaths = {
  configPath: string
  scriptPath: string
}

type HookAdapterContext = {
  copilotHome?: string
  homeDir: string
  root: string
}

export type HookAgentAdapter = {
  agent: HookAgent
  configKind: 'claude-settings' | 'codex-hooks' | 'copilot-hooks'
  supportedScopes: ReadonlySet<HookInstallScope>
  paths: (
    scope: HookInstallScope,
    context: HookAdapterContext,
  ) => HookAdapterPaths
}

const HOOK_SCRIPT_DIR = '.intent/hooks'

export const HOOK_AGENT_ADAPTERS: Record<HookAgent, HookAgentAdapter> = {
  claude: {
    agent: 'claude',
    configKind: 'claude-settings',
    supportedScopes: new Set(['project', 'user']),
    paths: (scope, { homeDir, root }) => {
      const project = scope === 'project'
      return {
        configPath: project
          ? join(root, '.claude', 'settings.json')
          : join(homeDir, '.claude', 'settings.json'),
        scriptPath: project
          ? join(root, HOOK_SCRIPT_DIR, 'intent-claude-catalog.mjs')
          : join(
              homeDir,
              '.tanstack',
              'intent',
              'hooks',
              'intent-claude-catalog.mjs',
            ),
      }
    },
  },
  codex: {
    agent: 'codex',
    configKind: 'codex-hooks',
    supportedScopes: new Set(['project', 'user']),
    paths: (scope, { homeDir, root }) => {
      const project = scope === 'project'
      return {
        configPath: project
          ? join(root, '.codex', 'hooks.json')
          : join(homeDir, '.codex', 'hooks.json'),
        scriptPath: project
          ? join(root, HOOK_SCRIPT_DIR, 'intent-codex-catalog.mjs')
          : join(
              homeDir,
              '.tanstack',
              'intent',
              'hooks',
              'intent-codex-catalog.mjs',
            ),
      }
    },
  },
  copilot: {
    agent: 'copilot',
    configKind: 'copilot-hooks',
    supportedScopes: new Set(['project', 'user']),
    paths: (scope, { copilotHome, homeDir, root }) => {
      const project = scope === 'project'
      return {
        configPath: project
          ? join(root, '.github', 'hooks', 'intent.json')
          : join(
              copilotHome ?? join(homeDir, '.copilot'),
              'hooks',
              'hooks.json',
            ),
        scriptPath: project
          ? join(root, HOOK_SCRIPT_DIR, 'intent-copilot-catalog.mjs')
          : join(
              homeDir,
              '.tanstack',
              'intent',
              'hooks',
              'intent-copilot-catalog.mjs',
            ),
      }
    },
  },
}

export const ALL_HOOK_AGENTS: Array<HookAgent> = ['copilot', 'claude', 'codex']
