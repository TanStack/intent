import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  buildCopilotProjectRunnerScript,
  buildHookRunnerScript,
} from '../../packages/intent/src/hooks/install.js'
import { createBenchOptions, createTempDir, writeJson } from './helpers.js'

const root = createTempDir('hook-runner')
const legacyScript = join(root, 'legacy-hook.mjs')
const packageRoot = join(import.meta.dirname, '..', '..', 'packages', 'intent')
const runnerDir = join(packageRoot, '.intent-hook-runner-bench')
const oneProcessScript = join(runnerDir, 'one-process-hook.mjs')
const cliPath = join(packageRoot, 'dist', 'cli.mjs')

function setup(): void {
  mkdirSync(runnerDir, { recursive: true })
  writeJson(join(root, 'package.json'), {
    name: 'intent-hook-runner-benchmark',
    private: true,
  })
  writeFileSync(
    legacyScript,
    buildHookRunnerScript('copilot', `node "${cliPath}" catalog --json`),
  )
  writeFileSync(
    oneProcessScript,
    buildCopilotProjectRunnerScript(`node "${cliPath}" catalog --json`),
  )
  run(oneProcessScript)
}

function teardown(): void {
  rmSync(root, { recursive: true, force: true })
  rmSync(runnerDir, { recursive: true, force: true })
}

function run(script: string): void {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({
      cwd: root,
      sessionId: 'benchmark-session',
      source: 'startup',
    }),
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout)
  }
}

describe('generated Copilot catalogue hook', () => {
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'legacy child CLI runner',
    () => run(legacyScript),
    createBenchOptions(setup, teardown),
  )

  bench(
    'one-process API runner',
    () => run(oneProcessScript),
    createBenchOptions(setup, teardown),
  )
})
