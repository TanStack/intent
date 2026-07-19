import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHookRunnerScript } from '../../../packages/intent/src/hooks/install.js'

const harnessDir = dirname(fileURLToPath(import.meta.url))
const intentCliPath = join(
  harnessDir,
  '..',
  '..',
  '..',
  'packages',
  'intent',
  'dist',
  'cli.mjs',
)
const runsDir = join(dirname(harnessDir), 'runs')
const hookHomeDir = join(runsDir, '.copilot-homes', 'catalogue')
const noHookHomeDir = join(runsDir, '.copilot-homes', 'no-hooks')

export type HookRun = {
  copilotHome: string
}

let builtHookHome: string | undefined
let builtNoHookHome: string | undefined

export function prepareHookRun(): HookRun {
  return { copilotHome: buildHookHome() }
}

export function prepareNoHookRun(): HookRun {
  if (builtNoHookHome) return { copilotHome: builtNoHookHome }

  const realHome = join(homedir(), '.copilot')
  rmSync(noHookHomeDir, { recursive: true, force: true })
  mkdirSync(noHookHomeDir, { recursive: true })
  copyIfPresent(
    join(realHome, 'config.json'),
    join(noHookHomeDir, 'config.json'),
  )
  copyIfPresent(
    join(realHome, 'permissions-config.json'),
    join(noHookHomeDir, 'permissions-config.json'),
  )
  copyIfPresent(join(realHome, 'ide'), join(noHookHomeDir, 'ide'))
  builtNoHookHome = noHookHomeDir
  return { copilotHome: noHookHomeDir }
}

function buildHookHome(): string {
  if (builtHookHome) return builtHookHome

  const realHome = join(homedir(), '.copilot')
  const hooksDir = join(hookHomeDir, 'hooks')
  const scriptPath = join(hooksDir, 'intent-copilot-catalog.mjs')
  mkdirSync(hooksDir, { recursive: true })
  copyIfPresent(join(realHome, 'config.json'), join(hookHomeDir, 'config.json'))
  copyIfPresent(
    join(realHome, 'permissions-config.json'),
    join(hookHomeDir, 'permissions-config.json'),
  )
  copyIfPresent(join(realHome, 'ide'), join(hookHomeDir, 'ide'))
  writeFileSync(
    scriptPath,
    buildHookRunnerScript('copilot', `node "${intentCliPath}" catalog --json`),
  )
  writeFileSync(
    join(hooksDir, 'hooks.json'),
    `${JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: 'command', command: `node "${scriptPath}"` }],
          subagentStart: [{ type: 'command', command: `node "${scriptPath}"` }],
        },
      },
      null,
      2,
    )}\n`,
  )
  builtHookHome = hookHomeDir
  return hookHomeDir
}

function copyIfPresent(source: string, destination: string): void {
  if (existsSync(source)) cpSync(source, destination, { recursive: true })
}
