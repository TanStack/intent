import { isEnvFlagSet } from './env-flag.js'

export interface FrozenModeOptions {
  frozen?: boolean
  noFrozen?: boolean
}

export interface FrozenModeContext {
  isTTY?: boolean
}

// M2-SPEC §8.1: --no-frozen is the highest-precedence explicit override,
// beating INTENT_FROZEN and the CI auto-detect alike.
export function isFrozenMode(
  options: FrozenModeOptions = {},
  context: FrozenModeContext = {},
): boolean {
  if (options.frozen && options.noFrozen) {
    throw new Error('Use either --frozen or --no-frozen, not both.')
  }

  if (options.frozen) return true
  if (options.noFrozen) return false
  if (isEnvFlagSet('INTENT_FROZEN')) return true

  const isTTY = context.isTTY ?? process.stdin.isTTY
  return isEnvFlagSet('CI') && isTTY !== true
}
