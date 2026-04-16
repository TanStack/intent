import { afterAll, beforeAll, bench, describe } from 'vitest'
import { createBenchmarkSuite } from './bench-utils.js'

const suite = createBenchmarkSuite()

describe('intent-cli', () => {
  /**
   * Running `vitest bench` ignores suite hooks, so we mirror setup and teardown
   * through tinybench. CodSpeed does the inverse and relies on `beforeAll` and
   * `afterAll`, so both are required.
   */
  beforeAll(suite.setup)
  afterAll(suite.teardown)

  bench('intent list scans a consumer workspace', suite.runListLoop, {
    warmupIterations: 100,
    time: 10_000,
    setup: suite.setup,
    teardown: suite.teardown,
  })

  bench('intent validate checks a shipped skills tree', suite.runValidateLoop, {
    warmupIterations: 100,
    time: 10_000,
    setup: suite.setup,
    teardown: suite.teardown,
  })

  bench('intent stale reports workspace drift', suite.runStaleLoop, {
    warmupIterations: 100,
    time: 10_000,
    setup: suite.setup,
    teardown: suite.teardown,
  })
})
