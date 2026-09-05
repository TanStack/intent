import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'vitest'

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
  test(
    'empty node process (baseline)',
    { timeout: 30_000 },
    async ({ bench }) => {
      await bench('empty node process (baseline)', () => {
        runNode(['-e', ''])
      }).run(coldStartBenchOptions)
    },
  )

  test('intent --help', { timeout: 30_000 }, async ({ bench }) => {
    await bench('intent --help', () => {
      runNode([cliPath, '--help'])
    }).run(coldStartBenchOptions)
  })
})
