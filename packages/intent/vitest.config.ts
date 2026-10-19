import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter } from 'node:path'
import { defineConfig } from 'vitest/config'

const gitBin = 'C:\\Program Files\\Git\\bin'
const pathEnv =
  process.platform === 'win32' && existsSync(gitBin)
    ? `${gitBin}${delimiter}${process.env.PATH ?? ''}`
    : process.env.PATH

export default defineConfig({
  test: {
    name: 'intent',
    // Source tests deliberately use an explicit immutable fixture reference.
    // Packed-release coverage separately checks the artifact's own metadata.
    env: {
      INTENT_WORKFLOW_REF: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v9.9.9',
      GIT_CEILING_DIRECTORIES: [
        ...new Set([tmpdir(), realpathSync(tmpdir())]),
      ].join(delimiter),
      TERM: 'xterm-256color',
      ...(pathEnv ? { PATH: pathEnv } : {}),
    },
    include: ['tests/**/*.test.ts'],
  },
})
