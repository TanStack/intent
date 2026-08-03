import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { failedSpans } from 'vitest-evals'
import { liveSessionCases } from './corpus/live-sessions'
import { attachEvalMetadata, score } from './graders/eval-metadata'
import { liveCopilotHarness } from './harness/live-copilot-harness'
import type { LiveSessionCase } from './corpus/live-sessions'
import type { SessionScore } from './graders/session-scoring'
import type { LiveCopilotOutput } from './harness/live-copilot-harness'
import type { HarnessContext, HarnessRun } from 'vitest-evals'

const smokeCase = liveSessionCases[0]!

describe('Intent discovery live Copilot harness', () => {
  it('returns an explicit unsupported result without a command backend', async () => {
    const result = await withCopilotCommand(undefined, () =>
      runLiveHarness(smokeCase),
    )

    expect(result.output).toEqual({
      runId: `live:${smokeCase.id}`,
      sessionPassed: false,
    })
    expect(result.artifacts?.runnerStatus).toBe('unsupported')
    expect(result.errors).toEqual([
      {
        message:
          'Live Copilot runner is not wired. Set INTENT_DISCOVERY_COPILOT_COMMAND.',
        type: 'LiveCopilotRunnerUnavailableError',
      },
    ])
    expect(failedSpans(result)).toHaveLength(1)
  })

  it('reuses one session ID across all six command turns', async () => {
    await withFakeRunner(
      [
        "import { appendFileSync, mkdirSync } from 'node:fs'",
        "import { dirname, join } from 'node:path'",
        'const home = process.env.COPILOT_HOME',
        'const sessionId = process.env.INTENT_DISCOVERY_SESSION_ID',
        'const turnId = process.env.INTENT_DISCOVERY_TURN_ID',
        "const events = join(home, 'session-state', sessionId, 'events.jsonl')",
        'mkdirSync(dirname(events), { recursive: true })',
        "appendFileSync(events, `${JSON.stringify({ type: 'user.message', data: { content: process.env.INTENT_DISCOVERY_PROMPT } })}\n`)",
        "const commands = { 'unrelated-format': 'npx @tanstack/intent catalog', 'router-loader': 'npx @tanstack/intent load @tanstack/router#routing', 'start-server-function': 'npx @tanstack/intent load @tanstack/start#server-functions', 'table-sorting': 'npx @tanstack/intent load @tanstack/table#v9-columns' }",
        'const command = commands[turnId]',
        "if (command) appendFileSync(events, `${JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'bash', arguments: { command } } })}\\n`)",
        "appendFileSync(events, `${JSON.stringify({ type: 'assistant.message', data: { content: sessionId, model: process.env.INTENT_DISCOVERY_COPILOT_MODEL } })}\\n`)",
        'console.log(`completed ${turnId}`)',
      ].join('\n'),
      async () => {
        const mappedCase = liveSessionCases.find(
          (session) => session.condition === 'mapped-intent',
        )!
        const result = await runLiveHarness(mappedCase)
        const turns = result.artifacts?.turns as Array<{
          catalogCommands: Array<string>
          finalAnswer: string
          intentLoads: Array<string>
        }>

        expect(result.artifacts?.runnerStatus).toBe('completed')
        expect(turns).toHaveLength(6)
        expect(turns[0]?.catalogCommands).toHaveLength(1)
        expect(turns[1]?.intentLoads).toEqual(['@tanstack/router#routing'])
        expect(new Set(turns.map((turn) => turn.finalAnswer)).size).toBe(1)
      },
    )
  })

  it('fails a turn when structured event evidence is malformed', async () => {
    await withFakeRunner(
      [
        "import { appendFileSync, mkdirSync } from 'node:fs'",
        "import { dirname, join } from 'node:path'",
        "const events = join(process.env.COPILOT_HOME, 'session-state', process.env.INTENT_DISCOVERY_SESSION_ID, 'events.jsonl')",
        'mkdirSync(dirname(events), { recursive: true })',
        "appendFileSync(events, '{bad json}' + String.fromCharCode(10))",
      ].join('\n'),
      async () => {
        const result = await runLiveHarness(smokeCase)
        expect(result.artifacts?.runnerStatus).toBe('failed')
        expect(result.artifacts?.turns).toEqual([])
        expect(result.errors).toHaveLength(1)
      },
    )
  })
})

describe('Intent discovery live sessions', () => {
  for (const sessionCase of liveSessionCases) {
    it.skipIf(process.env.INTENT_DISCOVERY_RUN_LIVE !== '1')(
      `live/${sessionCase.profile.id}/${sessionCase.condition}`,
      async ({ task: contextTask, expect }) => {
        const result = await runLiveHarness(sessionCase)
        const turns = result.artifacts?.turns as Array<{
          hookCatalogInjections: number
          model: string
        }>

        attachLiveSessionMetadata({ contextTask, result, sessionCase })

        expect(result.artifacts?.runnerStatus).toBe('completed')
        expect(turns).toHaveLength(sessionCase.turns.length)
        expect(
          turns.every((turn) => turn.model === sessionCase.profile.model),
        ).toBe(true)
        if (sessionCase.condition === 'hooked-intent') {
          expect(turns.every((turn) => turn.hookCatalogInjections === 1)).toBe(
            true,
          )
        }
        expect(result.errors).toEqual([])
      },
      1_800_000,
    )
  }
})

function attachLiveSessionMetadata({
  contextTask,
  result,
  sessionCase,
}: {
  contextTask: Parameters<typeof attachEvalMetadata>[0]['task']
  result: HarnessRun<LiveCopilotOutput>
  sessionCase: LiveSessionCase
}): void {
  const session = result.artifacts?.sessionScore as unknown as SessionScore
  const metadata = {
    condition: sessionCase.condition,
    effort: sessionCase.profile.effort,
    model: sessionCase.profile.model,
    profileId: sessionCase.profile.id,
  }
  const discoveryScores =
    sessionCase.condition === 'no-intent'
      ? []
      : [
          score('SessionSuccess', session.passed, metadata),
          score('CatalogBehavior', session.catalogCorrect, metadata),
          score(
            'RelatedDiscovery',
            session.relatedCorrect === session.relatedTotal,
            metadata,
          ),
          score(
            'UnrelatedAbstention',
            session.unrelatedCorrect === session.unrelatedTotal,
            metadata,
          ),
          score('NoWrongSkillLoads', session.wrongSkillLoads === 0, metadata),
        ]

  attachEvalMetadata({
    harnessName: liveCopilotHarness.name,
    run: result,
    scores: [
      ...discoveryScores,
      score(
        'TaskCompletion',
        session.taskCompletionCount === sessionCase.turns.length,
        metadata,
      ),
      score(
        'RunnerCompletion',
        session.runnerCompletionCount === sessionCase.turns.length,
        metadata,
      ),
    ],
    task: contextTask,
  })
}

async function withCopilotCommand<T>(
  command: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previousCommand = process.env.INTENT_DISCOVERY_COPILOT_COMMAND
  if (command) process.env.INTENT_DISCOVERY_COPILOT_COMMAND = command
  else delete process.env.INTENT_DISCOVERY_COPILOT_COMMAND

  try {
    return await run()
  } finally {
    if (previousCommand !== undefined) {
      process.env.INTENT_DISCOVERY_COPILOT_COMMAND = previousCommand
    }
  }
}

async function withFakeRunner(
  source: string,
  run: () => Promise<void>,
): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'intent-eval-runner-'))
  const runnerPath = join(tempDir, 'runner.mjs')
  writeFileSync(runnerPath, source)
  try {
    await withCopilotCommand(`node ${runnerPath}`, run)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runLiveHarness(
  input: LiveSessionCase,
): Promise<HarnessRun<LiveCopilotOutput>> {
  const artifacts: HarnessContext['artifacts'] = {}
  const context: HarnessContext = {
    artifacts,
    setArtifact(name, value) {
      artifacts[name] = value
    },
  }

  return liveCopilotHarness.run(input, context)
}
