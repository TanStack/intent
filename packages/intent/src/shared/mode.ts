import { isEnvFlagSet } from './env-flag.js'

export interface FrozenModeOptions {
  frozen?: boolean
  noFrozen?: boolean
}

export interface FrozenModeContext {
  isTTY?: boolean
}

// --no-frozen only overrides the CI auto-detect, never an explicit --frozen
// or INTENT_FROZEN — the RFC's "(overridable with --no-frozen)" clause reads
// as scoped to the auto-detect condition it directly follows.
export function isFrozenMode(
  options: FrozenModeOptions = {},
  context: FrozenModeContext = {},
): boolean {
  if (options.frozen && options.noFrozen) {
    throw new Error('Use either --frozen or --no-frozen, not both.')
  }

  if (options.frozen) return true
  if (isEnvFlagSet('INTENT_FROZEN')) return true
  if (options.noFrozen) return false

  const isTTY = context.isTTY ?? process.stdin.isTTY
  return isEnvFlagSet('CI') && isTTY !== true
}
