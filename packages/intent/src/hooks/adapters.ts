import { join } from 'node:path'
import type { HookAgent, HookInstallScope } from './types.js'

type HookAdapterPaths = {
  configPath: string
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
      }
    },
  },
  copilot: {
    agent: 'copilot',
    configKind: 'copilot-hooks',
    supportedScopes: new Set(['user']),
    paths: (_scope, { copilotHome, homeDir }) => ({
      configPath: join(
        copilotHome ?? join(homeDir, '.copilot'),
        'hooks',
        'hooks.json',
      ),
    }),
  },
}

export const ALL_HOOK_AGENTS: Array<HookAgent> = ['copilot', 'claude', 'codex']
