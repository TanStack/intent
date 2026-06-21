import { detectAgent, env } from 'std-env'
import type { IntentAudience } from '../core/types.js'

export function detectIntentAudience(
  explicit?: IntentAudience,
): IntentAudience {
  if (explicit) return explicit

  const override = env.INTENT_AUDIENCE?.trim().toLowerCase()
  if (override === 'agent' || override === 'human') return override
  if (override) {
    throw new Error(
      'Invalid INTENT_AUDIENCE value. Expected "agent" or "human".',
    )
  }

  return detectAgent().name ? 'agent' : 'human'
}
