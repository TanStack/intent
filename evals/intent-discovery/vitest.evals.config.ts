import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['evals/intent-discovery/**/*.eval.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    maxConcurrency: liveConcurrencyFromEnv(),
    reporters: ['default'],
    env: {
      VITEST_EVALS_REPLAY_DIR:
        process.env.VITEST_EVALS_REPLAY_DIR ??
        'evals/intent-discovery/.vitest-evals/recordings',
    },
  },
})

function liveConcurrencyFromEnv(): number {
  const raw = Number(process.env.INTENT_DISCOVERY_LIVE_CONCURRENCY ?? '1')

  if (!Number.isFinite(raw)) {
    return 1
  }

  return Math.max(1, Math.trunc(raw))
}
