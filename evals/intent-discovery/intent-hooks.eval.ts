import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyIntentCondition } from './harness/setup-intent-condition'
import { prepareCopilotRun } from './harness/prepare-copilot-home'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'

describe('hooked-intent condition setup', () => {
  it('installs the production context catalog hooks behind an observer', () => {
    const prepared = prepareFixtureWorkspace({ fixture: 'multi-turn' })

    try {
      applyIntentCondition({
        condition: 'hooked-intent',
        expectedSkillAreas: ['router', 'start', 'table-v9'],
        workspacePath: prepared.workspacePath,
      })
      const run = prepareCopilotRun({
        condition: 'hooked-intent',
        runId: 'test-hook-setup',
        sessionId: '00000000-0000-4000-8000-000000000001',
        workspacePath: prepared.workspacePath,
      })
      const config = JSON.parse(
        readFileSync(join(run.copilotHome, 'hooks', 'hooks.json'), 'utf8'),
      ) as {
        version: number
        hooks: {
          PreToolUse: Array<unknown>
          SessionStart: Array<{ command: string }>
          subagentStart: Array<{ command: string }>
        }
      }

      expect(run.hookCommand).toBe(
        'npx @tanstack/intent hooks run --agent copilot',
      )
      expect(config.version).toBe(1)
      expect(config.hooks.SessionStart[0]?.command).toContain(
        'catalog-observer.mjs',
      )
      expect(config.hooks.subagentStart[0]?.command).toContain(
        'catalog-observer.mjs',
      )
      expect(config.hooks.PreToolUse).toEqual([])
    } finally {
      prepared.cleanup()
    }
  })
})
