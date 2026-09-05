import codspeedPlugin from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

// CodSpeed's runner requires Vitest 4; the root test suite stays on Vitest 5.
export default defineConfig({
  plugins: [
    !!(process.env.VITEST && process.env.WITH_INSTRUMENTATION) &&
      codspeedPlugin(),
  ],
  test: {
    name: '@benchmarks/intent',
    watch: false,
    environment: 'node',
  },
})
