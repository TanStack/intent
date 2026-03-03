import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'playbooks',
    include: ['tests/**/*.test.ts'],
  },
})
