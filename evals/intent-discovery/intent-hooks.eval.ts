import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
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

  it('renders exact load commands through the observed production hook', () => {
    const prepared = prepareFixtureWorkspace({ fixture: 'multi-turn' })
    const tempDir = mkdtempSync(join(tmpdir(), 'intent-hook-observer-'))

    try {
      applyIntentCondition({
        condition: 'hooked-exact-intent',
        expectedSkillAreas: ['router', 'start', 'table-v9'],
        workspacePath: prepared.workspacePath,
      })
      const run = prepareCopilotRun({
        condition: 'hooked-exact-intent',
        runId: 'test-hook-exact-setup',
        workspacePath: prepared.workspacePath,
      })
      const config = JSON.parse(
        readFileSync(join(run.copilotHome, 'hooks', 'hooks.json'), 'utf8'),
      ) as {
        hooks: { SessionStart: Array<{ command: string }> }
      }
      const fakeHookPath = join(tempDir, 'hook.mjs')
      const statePath = join(tempDir, 'state.jsonl')
      writeFileSync(
        fakeHookPath,
        `process.stdout.write(JSON.stringify({ additionalContext: ${JSON.stringify(
          [
            'Available Intent skills:',
            '',
            '- @tanstack/router#routing: TanStack Router route loaders, route params, pending states, and loader data consumption.',
            '',
            'Before substantial work, run `intent load <id>` for each relevant skill listed above. If none apply, do not load a skill and continue normally.',
          ].join('\n'),
        )} }))\n`,
      )

      const result = spawnSync(config.hooks.SessionStart[0]!.command, {
        cwd: prepared.workspacePath,
        shell: true,
        input: '{"source":"new"}\n',
        encoding: 'utf8',
        env: {
          ...process.env,
          INTENT_DISCOVERY_HOOK_COMMAND: `node ${fakeHookPath}`,
          INTENT_DISCOVERY_HOOK_CONTEXT_FORMAT: 'exact-commands',
          INTENT_DISCOVERY_HOOK_STATE: statePath,
        },
      })
      const output = JSON.parse(result.stdout) as {
        additionalContext: string
      }

      expect(run.hookContextFormat).toBe('exact-commands')
      expect(result.status).toBe(0)
      expect(output.additionalContext).toContain(
        'Run: npx @tanstack/intent load @tanstack/router#routing',
      )
      expect(output.additionalContext).not.toContain('intent load <id>')
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({
        approximateTokenCount: Math.ceil(
          Buffer.byteLength(output.additionalContext) / 4,
        ),
        commandDurationMs: expect.any(Number),
        contextBytes: Buffer.byteLength(output.additionalContext),
        exactLoadCommands: true,
        lifecycleEventName: 'SessionStart',
        omittedSkillCount: 0,
        representedSkillCount: 1,
      })

      const oversizedContext = [
        'Available Intent skills:',
        '',
        ...Array.from(
          { length: 20 },
          (_, index) =>
            `- @tanstack/package#skill-${index}: ${'description '.repeat(12)}`,
        ),
        '',
        'Before substantial work, run `intent load <id>` for each relevant skill listed above. If none apply, do not load a skill and continue normally.',
      ].join('\n')
      writeFileSync(
        fakeHookPath,
        `process.stdout.write(JSON.stringify({ additionalContext: ${JSON.stringify(oversizedContext)} }))\n`,
      )
      const bounded = spawnSync(config.hooks.SessionStart[0]!.command, {
        cwd: prepared.workspacePath,
        shell: true,
        input: '{}\n',
        encoding: 'utf8',
        env: {
          ...process.env,
          INTENT_DISCOVERY_HOOK_COMMAND: `node ${fakeHookPath}`,
          INTENT_DISCOVERY_HOOK_CONTEXT_FORMAT: 'exact-commands',
          INTENT_DISCOVERY_HOOK_MAX_BYTES: '512',
        },
      })
      const boundedContext = (
        JSON.parse(bounded.stdout) as { additionalContext: string }
      ).additionalContext

      expect(Buffer.byteLength(boundedContext)).toBeLessThanOrEqual(512)
      expect(boundedContext).toMatch(/additional skills omitted/)
    } finally {
      prepared.cleanup()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
