import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const harnessDir = dirname(fileURLToPath(import.meta.url))
const hooksSourceDir = join(harnessDir, 'intent-hooks')
const runsDir = join(dirname(harnessDir), 'runs')
const gateHomeDir = join(runsDir, '.copilot-homes', 'gate')
const gateStateDir = join(runsDir, 'latest', 'gate-state')

export type GateRun = {
  copilotHome: string
  stateFile: string
}

let builtGateHome: string | undefined

export function prepareGateRun(runId: string): GateRun {
  const copilotHome = buildGateHome()

  mkdirSync(gateStateDir, { recursive: true })
  const stateFile = join(gateStateDir, `${runId}.jsonl`)
  rmSync(stateFile, { force: true })

  return { copilotHome, stateFile }
}

function buildGateHome(): string {
  if (builtGateHome) {
    return builtGateHome
  }

  const realHome = join(homedir(), '.copilot')

  mkdirSync(join(gateHomeDir, 'hooks'), { recursive: true })
  copyIfPresent(join(realHome, 'config.json'), join(gateHomeDir, 'config.json'))
  copyIfPresent(
    join(realHome, 'permissions-config.json'),
    join(gateHomeDir, 'permissions-config.json'),
  )
  copyIfPresent(join(realHome, 'ide'), join(gateHomeDir, 'ide'))

  const command = `node ${join(hooksSourceDir, 'gate.mjs')}`

  writeFileSync(
    join(gateHomeDir, 'hooks', 'hooks.json'),
    `${JSON.stringify({ hooks: { PreToolUse: [{ command }] } }, null, 2)}\n`,
  )

  builtGateHome = gateHomeDir

  return gateHomeDir
}

function copyIfPresent(source: string, destination: string): void {
  if (existsSync(source)) {
    cpSync(source, destination, { recursive: true })
  }
}
