import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  prepareHookRun,
  prepareNoHookRun,
} from './harness/prepare-copilot-home'
import { applyIntentCondition } from './harness/setup-intent-condition'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'

describe('hooked-intent condition setup', () => {
  it('prepares an isolated Copilot home without hooks', () => {
    const { copilotHome } = prepareNoHookRun()

    expect(existsSync(join(copilotHome, 'hooks', 'hooks.json'))).toBe(false)
  })

  it('uses lifecycle catalogue hooks without static mappings or an edit gate', () => {
    const prepared = prepareFixtureWorkspace({ fixture: 'router-basic' })

    try {
      applyIntentCondition({
        condition: 'hooked-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const { copilotHome } = prepareHookRun()
      const hooks = JSON.parse(
        readFileSync(join(copilotHome, 'hooks', 'hooks.json'), 'utf8'),
      ) as { hooks: Record<string, Array<unknown>> }

      expect(existsSync(join(prepared.workspacePath, 'AGENTS.md'))).toBe(false)
      expect(hooks.hooks.sessionStart).toHaveLength(1)
      expect(hooks.hooks.subagentStart).toHaveLength(1)
      expect(hooks.hooks.PreToolUse).toBeUndefined()
    } finally {
      prepared.cleanup()
    }
  })
})
