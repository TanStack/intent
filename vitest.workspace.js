import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './packages/playbooks/vitest.config.ts',
    ],
  },
})
