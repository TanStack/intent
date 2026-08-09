import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRunsDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'runs',
)

export function resolveRunsDir(): string {
  return process.env.INTENT_DISCOVERY_RUNS_DIR ?? defaultRunsDir
}
