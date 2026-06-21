import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const ATTRIB_FILE = process.env.INTENT_DISCOVERY_GATE_STATE

export function readEventFromStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

export function appendObservation(observation) {
  if (!ATTRIB_FILE) {
    return
  }

  try {
    mkdirSync(dirname(ATTRIB_FILE), { recursive: true })
    appendFileSync(
      ATTRIB_FILE,
      `${JSON.stringify({ ts: new Date().toISOString(), ...observation })}\n`,
    )
  } catch {
    // Fail open: a hook must never brick the run.
  }
}

export function readObservations() {
  if (!ATTRIB_FILE || !existsSync(ATTRIB_FILE)) {
    return []
  }

  try {
    return readFileSync(ATTRIB_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}
