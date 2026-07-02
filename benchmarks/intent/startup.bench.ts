import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bench, describe } from 'vitest'

const cliPath = fileURLToPath(
  new URL('../../packages/intent/dist/cli.mjs', import.meta.url),
)

const coldStartBenchOptions = {
  warmupIterations: 20,
  time: 3_000,
}

function runNode(args: Array<string>): void {
  const result = spawnSync(process.execPath, args, {
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
})
