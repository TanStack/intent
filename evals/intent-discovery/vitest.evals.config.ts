import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['evals/intent-discovery/**/*.eval.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default'],
    env: {
      VITEST_EVALS_REPLAY_DIR:
        process.env.VITEST_EVALS_REPLAY_DIR ??
        'evals/intent-discovery/.vitest-evals/recordings',
    },
  },
})
