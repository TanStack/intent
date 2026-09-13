import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, bench, describe } from 'vitest'

const cliPath = fileURLToPath(
  new URL('../../packages/intent/dist/cli.mjs', import.meta.url),
)

const coldStartBenchOptions = {
  warmupIterations: 20,
  time: 3_000,
}

function runNode(args: Array<string>, cwd?: string): void {
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: 'ignore',
    timeout: 10_000,
  })
  if (result.status !== 0) {
    throw new Error(
      `spawn ${[process.execPath, ...args].join(' ')} exited with code ${result.status}`,
    )
  }
}

describe('cold start', () => {
  let root: string | undefined
  function setup() {
    if (root) return
    root = mkdtempSync(join(tmpdir(), 'intent-prose-startup-'))
    writeFileSync(
      join(root, 'package.json'),
      '{"name":"prose-library","version":"1.0.0"}\n',
    )
    mkdirSync(join(root, 'skills', 'guide'), { recursive: true })
    writeFileSync(
      join(root, 'skills', 'guide', 'SKILL.md'),
      '---\nname: guide\ndescription: Use when reading the guide.\n---\nProse-only guidance.\n',
    )
  }
  function teardown() {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  }
  beforeAll(setup)
  afterAll(teardown)

  bench(
    'empty node process (baseline)',
    () => {
      runNode(['-e', ''])
    },
    coldStartBenchOptions,
  )

  bench(
    'intent --help',
    () => {
      runNode([cliPath, '--help'])
    },
    coldStartBenchOptions,
  )

  bench(
    'intent validate prose-only skills',
    () => {
      setup()
      runNode([cliPath, 'validate'], root)
    },
    { ...coldStartBenchOptions, setup, teardown },
  )
})
