import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
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
        "if (turnId === 'unrelated-format') appendFileSync(events, `${JSON.stringify({ type: 'session.start', data: { copilotVersion: '1.0.79-2' } })}\\n`)",
        "appendFileSync(events, `${JSON.stringify({ type: 'session.usage_checkpoint', data: { modelCacheState: [{ cacheExpiresAt: '2026-08-05T04:00:00.000Z', cacheTtlSeconds: 300, modelId: process.env.INTENT_DISCOVERY_COPILOT_MODEL }] } })}\\n`)",
        "appendFileSync(events, `${JSON.stringify({ type: 'user.message', data: { content: process.env.INTENT_DISCOVERY_PROMPT } })}\n`)",
        "const loads = { 'router-loader': ['@tanstack/router#routing', 'routing', 'TanStack Router route loaders, route params, pending states, and loader data consumption.'], 'start-server-function': ['@tanstack/start#server-functions', 'server-functions', 'TanStack Start server functions, handlers, validation, and route loader integration.'], 'table-sorting': ['@tanstack/table#v9-columns', 'v9-columns', 'TanStack Table v9 column definitions, controlled sorting state, sorting handlers, and row models.'] }",
        'const load = loads[turnId]',
        "if (load) appendFileSync(events, `${JSON.stringify({ type: 'tool.execution_start', data: { toolCallId: turnId, toolName: 'bash', arguments: { command: `npx @tanstack/intent load ${load[0]}` } } })}\\n${JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: turnId, result: { content: `---\\nname: \\\"${load[1]}\\\"\\ndescription: \\\"${load[2]}\\\"\\n---` } } })}\\n`)",
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
        expect(result.artifacts).toMatchObject({
          cacheStatus: 'observed',
          copilotVersion: '1.0.79-2',
          modelCacheState: [
            {
              cacheExpiresAt: '2026-08-05T04:00:00.000Z',
              cacheTtlSeconds: 300,
              modelId: mappedCase.profile.model,
            },
          ],
        })
        expect(turns).toHaveLength(6)
        expect(turns[0]?.catalogCommands).toHaveLength(0)
        expect(turns[1]?.intentLoads).toEqual(['@tanstack/router#routing'])
        expect(new Set(turns.map((turn) => turn.finalAnswer)).size).toBe(1)
        const runsDir = process.env.INTENT_DISCOVERY_RUNS_DIR
        expect(runsDir).toBeDefined()
        expect(
          existsSync(
            join(runsDir!, 'latest', 'sessions', `live-${mappedCase.id}.json`),
          ),
        ).toBe(true)
        expect(
          JSON.parse(
            readFileSync(
              join(
                runsDir!,
                'latest',
                'sessions',
                `live-${mappedCase.id}.json`,
              ),
              'utf8',
            ),
          ),
        ).toMatchObject({
          cacheStatus: 'observed',
          copilotVersion: '1.0.79-2',
          runId: `live:${mappedCase.id}`,
        })
      },
    )
  })

  it('preserves completed turns when structured event evidence is malformed', async () => {
    await withFakeRunner(
      [
        "import { appendFileSync, mkdirSync } from 'node:fs'",
        "import { dirname, join } from 'node:path'",
        "const events = join(process.env.COPILOT_HOME, 'session-state', process.env.INTENT_DISCOVERY_SESSION_ID, 'events.jsonl')",
        'mkdirSync(dirname(events), { recursive: true })',
        "if (process.env.INTENT_DISCOVERY_TURN_ID === 'unrelated-format') appendFileSync(events, `${JSON.stringify({ type: 'assistant.message', data: { content: 'completed', model: process.env.INTENT_DISCOVERY_COPILOT_MODEL } })}\\n`)",
        "else appendFileSync(events, '{bad json}' + String.fromCharCode(10))",
      ].join('\n'),
      async () => {
        const result = await runLiveHarness(smokeCase)
        expect(result.artifacts?.runnerStatus).toBe('completed')
        expect(result.artifacts?.turns).toMatchObject([
          { id: 'unrelated-format', runnerCompleted: true },
          { id: 'router-loader', runnerCompleted: false },
        ])
        expect(
          (result.artifacts?.sessionScore as SessionScore)
            .runnerCompletionCount,
        ).toBe(1)
        expect(result.errors).toHaveLength(1)
      },
    )
  })

  it('counts subagent hook injections separately from session starts', async () => {
    await withFakeRunner(
      [
        "import { appendFileSync, mkdirSync } from 'node:fs'",
        "import { dirname, join } from 'node:path'",
        "const events = join(process.env.COPILOT_HOME, 'session-state', process.env.INTENT_DISCOVERY_SESSION_ID, 'events.jsonl')",
        'mkdirSync(dirname(events), { recursive: true })',
        "appendFileSync(events, `${JSON.stringify({ type: 'assistant.message', data: { content: 'completed', model: process.env.INTENT_DISCOVERY_COPILOT_MODEL } })}\\n`)",
        "const stdout = JSON.stringify({ additionalContext: 'Available Intent skills:' })",
        "appendFileSync(process.env.INTENT_DISCOVERY_HOOK_STATE, `${JSON.stringify({ contextBytes: 25, exitCode: 0, lifecycleEventName: 'SessionStart', stdout })}\\n`)",
        "appendFileSync(process.env.INTENT_DISCOVERY_HOOK_STATE, `${JSON.stringify({ contextBytes: 25, exitCode: 0, lifecycleEventName: 'SubagentStart', stdout })}\\n`)",
      ].join('\n'),
      async () => {
        const hookedCase = liveSessionCases.find(
          (session) => session.condition === 'hooked-intent',
        )!
        const result = await runLiveHarness(hookedCase)
        const turns = result.artifacts?.turns as Array<{
          hookCatalogInjections: number
          hookSubagentCatalogInjections: number
        }>

        expect(result.artifacts?.runnerStatus).toBe('completed')
        expect(
          (result.artifacts?.sessionScore as SessionScore).catalogCorrect,
        ).toBe(true)
        expect(turns).toHaveLength(hookedCase.turns.length)
        expect(
          turns.every(
            (turn) =>
              turn.hookCatalogInjections === 1 &&
              turn.hookSubagentCatalogInjections === 1,
          ),
        ).toBe(true)
      },
    )
  })
})

describe('Intent discovery summary report', () => {
  it('separates runner, transport, discovery, outcome, and context metrics', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'intent-summary-'))
    const reportPath = join(tempDir, 'vitest-results.json')
    writeFileSync(reportPath, `${JSON.stringify(summaryReportFixture())}\n`)

    try {
      const result = spawnSync(
        process.execPath,
        [
          join(
            process.cwd(),
            'evals/intent-discovery/bin/summarize-results.mjs',
          ),
          reportPath,
        ],
        { encoding: 'utf8' },
      )
      const summary = JSON.parse(
        readFileSync(join(tempDir, 'summary.json'), 'utf8'),
      ) as {
        byCondition: Record<string, Record<string, unknown>>
        byProfile: Array<Record<string, unknown>>
        totals: Record<string, unknown>
      }

      expect(result.status).toBe(0)
      expect(summary.totals).toMatchObject({
        attemptedLiveSessions: 2,
        completedLiveSessions: 1,
        failedLiveSessions: 1,
      })
      expect(summary.byCondition['hooked-exact-intent']).toMatchObject({
        attemptedSessions: 2,
        completedSessions: 1,
        deniedSkillLoads: 1,
        duplicateSkillLoads: 1,
        failedSessions: 1,
        failedSkillLoads: 2,
        hookContextReceipts: 2,
        hookExactCommandOutputs: 2,
        hookExitedSuccessfully: 2,
        hookInvocations: 2,
        hookValidOutputs: 2,
        medianHookCommandDurationMs: 12,
        medianHookOmittedSkillCount: 1,
        medianHookRepresentedSkillCount: 4,
        medianInjectedBytes: 640,
        missedSkillLoads: 1,
        unnecessarySkillLoads: 0,
        wrongSkillLoads: 1,
      })
      expect(summary.byProfile[0]).toMatchObject({
        cacheStatus: 'observed',
        copilotVersion: '1.0.79-2',
        modelCacheState: [
          {
            cacheExpiresAt: '2026-08-05T04:00:00.000Z',
            cacheTtlSeconds: 300,
            modelId: 'test-model',
          },
        ],
        runId: 'live:test-low-run-1-hooked-exact-intent',
      })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
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
        if (
          sessionCase.condition === 'hooked-intent' ||
          sessionCase.condition === 'hooked-exact-intent'
        ) {
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
  const previousRunsDir = process.env.INTENT_DISCOVERY_RUNS_DIR
  process.env.INTENT_DISCOVERY_RUNS_DIR = join(tempDir, 'runs')
  writeFileSync(runnerPath, source)
  try {
    await withCopilotCommand(`node ${runnerPath}`, run)
  } finally {
    if (previousRunsDir === undefined) {
      delete process.env.INTENT_DISCOVERY_RUNS_DIR
    } else {
      process.env.INTENT_DISCOVERY_RUNS_DIR = previousRunsDir
    }
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

function summaryReportFixture() {
  const artifacts = {
    cacheStatus: 'observed',
    condition: 'hooked-exact-intent',
    copilotVersion: '1.0.79-2',
    hookContexts: [
      'Available Intent skills:\n\n- @tanstack/router#routing\n  Use for: Router.\n  Run: npx @tanstack/intent load @tanstack/router#routing',
    ],
    profile: { effort: 'low', id: 'test-low', model: 'test-model' },
    repetition: 1,
    modelCacheState: [
      {
        cacheExpiresAt: '2026-08-05T04:00:00.000Z',
        cacheTtlSeconds: 300,
        modelId: 'test-model',
      },
    ],
    runId: 'live:test-low-run-1-hooked-exact-intent',
    runKind: 'live-copilot',
    runnerStatus: 'completed',
    sessionScore: {
      agentCatalogCount: 0,
      catalogCorrect: true,
      deniedSkillLoads: 1,
      duplicateSkillLoads: 1,
      failedSkillLoads: 2,
      hookCatalogInjections: 2,
      missedSkillLoads: 1,
      passed: false,
      relatedCorrect: 0,
      relatedTotal: 1,
      runnerCompletionCount: 2,
      taskCompletionCount: 1,
      turnResults: [
        { discoveryCorrect: false, id: 'router-loader', passed: false },
        { discoveryCorrect: true, id: 'unrelated-format', passed: true },
      ],
      unrelatedCorrect: 1,
      unrelatedTotal: 1,
      unnecessarySkillLoads: 0,
      wrongSkillLoads: 1,
    },
    turns: [
      summaryTurn('router-loader', false, 1_000, 10),
      summaryTurn('unrelated-format', true, 2_000, 14),
    ],
  }

  return {
    numFailedTests: 1,
    numPassedTests: 1,
    numTotalTestSuites: 1,
    testResults: [
      {
        assertionResults: [
          summaryAssertion(artifacts, [
            { name: 'SessionSuccess', score: 0 },
            { name: 'CatalogBehavior', score: 1 },
          ]),
          summaryAssertion(
            {
              ...artifacts,
              repetition: 2,
              runnerStatus: 'failed',
              sessionScore: {},
              turns: [],
            },
            [],
          ),
        ],
      },
    ],
  }
}

function summaryTurn(
  id: string,
  taskPassed: boolean,
  durationMs: number,
  hookCommandDurationMs: number,
) {
  const related = id === 'router-loader'
  return {
    catalogCommands: [],
    durationMs,
    hookCatalogInjections: 1,
    hookCommandDurationMs,
    hookContextReceipts: 1,
    hookExactCommandOutputs: 1,
    hookExitedSuccessfully: 1,
    hookInjectedBytes: 640,
    hookInvocations: 1,
    hookOmittedSkillCount: related ? 0 : 2,
    hookRepresentedSkillCount: related ? 3 : 5,
    hookSubagentCatalogInjections: 0,
    hookValidOutputs: 1,
    id,
    taskPassed,
  }
}

function summaryAssertion(
  artifacts: Record<string, unknown>,
  scores: Array<{ name: string; score: number }>,
) {
  return {
    meta: {
      eval: { scores },
      harness: { run: { artifacts } },
    },
  }
}
