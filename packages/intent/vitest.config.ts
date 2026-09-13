import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'intent',
    // Source tests deliberately use an explicit immutable fixture reference.
    // Packed-release coverage separately checks the artifact's own metadata.
    env: {
      INTENT_WORKFLOW_REF: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v9.9.9',
    },
    include: ['tests/**/*.test.ts'],
  },
})
