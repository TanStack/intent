#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const command = process.env.INTENT_DISCOVERY_HOOK_COMMAND
const stateFile = process.env.INTENT_DISCOVERY_HOOK_STATE
const input = readFileSync(0)

if (!command) process.exit(1)

const result = spawnSync(command, {
  cwd: process.cwd(),
  shell: true,
  input,
  encoding: 'buffer',
  env: process.env,
})

if (stateFile) {
  mkdirSync(dirname(stateFile), { recursive: true })
  appendFileSync(
    stateFile,
    `${JSON.stringify({
      exitCode: result.status,
      stderr: result.stderr.toString('utf8'),
      stdout: result.stdout.toString('utf8'),
    })}\n`,
  )
}

process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)