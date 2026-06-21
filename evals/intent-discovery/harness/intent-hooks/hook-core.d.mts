export type IntentAction = 'list' | 'load'

export type IntentInvocation = {
  action: IntentAction
  skillUse?: string
}

export type IntentObservation = {
  action: IntentAction
  skillUse?: string
  raw: string
}

export type GateDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }

export const EDIT_TOOLS: Set<string>
export const GATE_DENY_REASON: string

export function parseIntentInvocation(
  command: unknown,
): IntentInvocation | undefined

export function observationFromEvent(
  event: unknown,
): IntentObservation | undefined

export function gateDecision(input: {
  toolName: unknown
  hasLoaded: boolean
}): GateDecision

export function hasLoadFromObservations(
  observations: Array<{ action?: string } | null | undefined>,
): boolean
