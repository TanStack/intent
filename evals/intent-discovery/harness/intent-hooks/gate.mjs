#!/usr/bin/env node
import {
  appendObservation,
  readEventFromStdin,
  readObservations,
} from './hook-io.mjs'
import {
  gateDecision,
  hasLoadFromObservations,
  observationFromEvent,
} from './hook-core.mjs'

try {
  const event = readEventFromStdin()
  const observation = observationFromEvent(event)

  if (observation) {
    appendObservation(observation)
  }

  const toolName = event?.tool_name ?? event?.toolName
  const decision = gateDecision({
    toolName,
    hasLoaded: hasLoadFromObservations(readObservations()),
  })

  if (decision.decision === 'deny') {
    process.stdout.write(
      JSON.stringify({
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason,
      }),
    )
  }
} catch {
  // Fail open: never block on hook error.
}

process.exit(0)
