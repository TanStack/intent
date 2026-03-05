import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'intent',
    include: ['tests/**/*.test.ts'],
  },
})
