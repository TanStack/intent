#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const workspace = requiredEnv('INTENT_DISCOVERY_WORKSPACE')
const taskId = requiredEnv('INTENT_DISCOVERY_TASK_ID')
const fixture = requiredEnv('INTENT_DISCOVERY_FIXTURE')
const prompt = requiredEnv('INTENT_DISCOVERY_PROMPT')
const runId = requiredEnv('INTENT_DISCOVERY_RUN_ID')
const sharePath = join(
  workspace,
  '.intent-eval',
  `${sanitizeFileName(runId)}.md`,
)

mkdirSync(dirname(sharePath), { recursive: true })

const copilotPrompt = [
  `Task id: ${taskId}`,
  `Fixture: ${fixture}`,
  '',
  prompt,
  '',
  'Work in the current repository. Use the available project context and tools as you normally would. Do not summarize this prompt; complete the task and report what you changed.',
].join('\n')

const args = [
  '-p',
  copilotPrompt,
  '-C',
  workspace,
  '--allow-all-tools',
  '--add-dir',
  workspace,
  '--no-ask-user',
  '--no-color',
  '--plain-diff',
  '--share',
  sharePath,
]

const result = spawnSync('copilot', args, {
  cwd: workspace,
  encoding: 'utf8',
  env: {
    ...process.env,
    NO_COLOR: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.stdout.trim()) {
  console.log(result.stdout.trim())
}

if (existsSync(sharePath)) {
  console.log(`\nTRANSCRIPT_PATH: ${sharePath}`)
  console.log(readFileSync(sharePath, 'utf8'))
}

if (result.stderr.trim()) {
  console.error(result.stderr.trim())
}

process.exit(result.status ?? 1)

function requiredEnv(name) {
  const value = process.env[name]

  if (!value) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }

  return value
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9.-]+/gi, '-')
}
