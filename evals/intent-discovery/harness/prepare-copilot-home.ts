import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInstallHooks } from '../../../packages/intent/src/hooks/install.js'
import type { IntentDiscoveryCondition } from '../corpus/conditions'

const harnessDir = dirname(fileURLToPath(import.meta.url))
const runsDir = join(dirname(harnessDir), 'runs')
const copilotHomesDir = join(runsDir, '.copilot-homes')
const hookStateDir = join(runsDir, 'latest', 'hook-state')
const hookObserverPath = join(
  harnessDir,
  'intent-hooks',
  'catalog-observer.mjs',
)

export type CopilotRun = {
  copilotHome: string
  hookCommand?: string
  hookStateFile?: string
  sessionId: string
}

export function prepareCopilotRun({
  condition,
  runId,
  sessionId,
  workspacePath,
}: {
  condition: IntentDiscoveryCondition
  runId: string
  sessionId: string
  workspacePath: string
}): CopilotRun {
  const copilotHome = buildCopilotHome(condition, runId)

  if (condition !== 'hooked-intent') return { copilotHome, sessionId }

  const hookCommand = installObservedCatalogHook({
    copilotHome,
    workspacePath,
  })
  mkdirSync(hookStateDir, { recursive: true })
  const hookStateFile = join(hookStateDir, `${runId}.jsonl`)
  rmSync(hookStateFile, { force: true })

  return { copilotHome, hookCommand, hookStateFile, sessionId }
}

function buildCopilotHome(
  condition: IntentDiscoveryCondition,
  runId: string,
): string {
  const realHome = join(homedir(), '.copilot')
  const copilotHome = join(copilotHomesDir, condition, runId)

  rmSync(copilotHome, { recursive: true, force: true })
  mkdirSync(join(copilotHome, 'hooks'), { recursive: true })
  copyIfPresent(join(realHome, 'config.json'), join(copilotHome, 'config.json'))
  copyIfPresent(
    join(realHome, 'permissions-config.json'),
    join(copilotHome, 'permissions-config.json'),
  )
  copyIfPresent(join(realHome, 'ide'), join(copilotHome, 'ide'))

  return copilotHome
}

function installObservedCatalogHook({
  copilotHome,
  workspacePath,
}: {
  copilotHome: string
  workspacePath: string
}): string {
  runInstallHooks({
    agents: 'copilot',
    copilotHome,
    root: workspacePath,
    scope: 'user',
  })

  const configPath = join(copilotHome, 'hooks', 'hooks.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    hooks?: {
      SessionStart?: Array<{ command?: unknown }>
      subagentStart?: Array<{ command?: unknown }>
    }
  }
  const command = config.hooks?.SessionStart?.[0]?.command
  if (typeof command !== 'string' || command === '') {
    throw new Error('Intent did not install a Copilot SessionStart hook.')
  }
  const subagentCommand = config.hooks?.subagentStart?.[0]?.command
  if (subagentCommand !== command) {
    throw new Error('Intent did not install a matching Copilot subagent hook.')
  }

  config.hooks!.SessionStart![0]!.command = `node ${hookObserverPath}`
  config.hooks!.subagentStart![0]!.command = `node ${hookObserverPath}`
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  return command
}

function copyIfPresent(source: string, destination: string): void {
  if (existsSync(source)) {
    cpSync(source, destination, { recursive: true })
  }
}
