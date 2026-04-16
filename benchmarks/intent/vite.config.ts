import { fileURLToPath } from 'node:url'
import codspeedPlugin from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: rootDir,
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
