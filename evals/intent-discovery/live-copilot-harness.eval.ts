import { existsSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessContext, HarnessRun } from 'vitest-evals'
import { describe, expect, it } from 'vitest'
import { failedSpans, toolCalls } from 'vitest-evals'
import { countsTowardAutonomousScore } from './corpus/conditions'
import { tasks, type IntentDiscoveryTask } from './corpus/tasks'
import { correctSkillLoaded } from './graders/correct-skill-loaded'
import { attachEvalMetadata, score } from './graders/eval-metadata'
import { classifyFailure } from './graders/failure-classifier'
import { referenceOnly } from './graders/reference-only'
import { strictIntentInvocation } from './graders/strict-invocation'
import {
  liveCopilotHarness,
  type LiveCopilotOutput,
} from './harness/live-copilot-harness'

const routerTask = tasks.find(
  (task) => task.id === 'router-current-intent-loads-router',
)

if (!routerTask) {
  throw new Error('Missing router-current-intent-loads-router task')
}

describe('Intent discovery live Copilot harness', () => {
  it('returns an explicit unsupported result until live capture is wired', async () => {
    const result = await withoutCopilotCommand(() => runLiveHarness(routerTask))

    expect(result.output).toEqual({
      finalAnswer: '',
      runId: `live:${routerTask.id}`,
    })
    expect(result.artifacts?.runKind).toBe('live-copilot')
    expect(result.artifacts?.runnerStatus).toBe('unsupported')
    expect(result.artifacts?.workspacePath).toEqual(expect.any(String))
    expect(toolCalls(result)).toHaveLength(0)
    expect(result.errors).toEqual([
      {
        message:
          'Live Copilot runner is not wired yet. Use saved transcripts until the runner can launch Copilot and capture transcript, command, and diff evidence.',
        type: 'LiveCopilotRunnerUnavailableError',
      },
    ])
    expect(failedSpans(result)).toHaveLength(1)
  })

  it('runs an opt-in command backend and captures command, skill, transcript, and diff evidence', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'intent-eval-command-'))
    const fakeRunnerPath = join(tempDir, 'fake-runner.mjs')
    const previousCommand = process.env.INTENT_DISCOVERY_COPILOT_COMMAND

    writeFileSync(
      fakeRunnerPath,
      [
        "import { writeFileSync } from 'node:fs'",
        "writeFileSync('agent-output.txt', process.env.INTENT_DISCOVERY_TASK_ID ?? '')",
        "console.log('$ intent list')",
        "console.log('@tanstack/router#routing - Router route guidance')",
        "console.log('$ intent load @tanstack/router#routing')",
        "console.log('Loaded @tanstack/router#routing')",
        "console.log('FINAL_ANSWER: Loaded router guidance and updated the fixture.')",
      ].join('\n'),
    )
    process.env.INTENT_DISCOVERY_COPILOT_COMMAND = `node ${fakeRunnerPath}`

    try {
      const result = await runLiveHarness(routerTask)

      expect(result.errors).toEqual([])
      expect(result.output.finalAnswer).toBe(
        'Loaded router guidance and updated the fixture.',
      )
      expect(result.artifacts?.runnerStatus).toBe('completed')
      expect(result.artifacts?.intentCommandsInvoked).toEqual([
        'intent list',
        'intent load @tanstack/router#routing',
      ])
      expect(result.artifacts?.loadedSkills).toEqual([
        '@tanstack/router#routing',
      ])
      expect(result.artifacts?.fileDiff).toEqual(
        expect.stringContaining('agent-output.txt'),
      )
      expect(result.artifacts?.transcriptPath).toEqual(expect.any(String))
      expect(existsSync(String(result.artifacts?.transcriptPath))).toBe(true)
      expect(toolCalls(result)).toHaveLength(2)
      expect(failedSpans(result)).toHaveLength(0)
    } finally {
      if (previousCommand === undefined) {
        delete process.env.INTENT_DISCOVERY_COPILOT_COMMAND
      } else {
        process.env.INTENT_DISCOVERY_COPILOT_COMMAND = previousCommand
      }
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.env.INTENT_DISCOVERY_RUN_LIVE !== '1')(
    'runs the configured live backend',
    async (context) => {
      const result = await runLiveHarness(routerTask)
      const strict = strictIntentInvocation(result)
      const loaded = correctSkillLoaded(result, routerTask.expectedSkillAreas)
      const reference = referenceOnly(result, routerTask.expectedSkillAreas)
      const failureClass = classifyFailure(
        result,
        routerTask.expectedSkillAreas,
      )
      const autonomous = countsTowardAutonomousScore({
        condition: routerTask.condition,
        explicitnessLevel: routerTask.explicitnessLevel,
      })

      attachEvalMetadata({
        harnessName: liveCopilotHarness.name,
        run: result,
        scores: [
          score(
            'AutonomousDiscoverySuccess',
            autonomous && strict.passed && loaded.passed,
            {
              rationale:
                'Scores only autonomous live runs where Copilot invoked Intent and loaded the expected skill.',
              failureClass,
              runnerStatus: String(result.artifacts?.runnerStatus ?? ''),
            },
          ),
          score('StrictIntentInvocation', strict.passed, {
            matchedCommand: strict.matchedCommand,
            source: strict.source,
          }),
          score('CorrectSkillLoaded', loaded.passed, {
            loadedSkills: loaded.loadedSkills,
            expectedSkillAreas: routerTask.expectedSkillAreas,
          }),
          score('NoReferenceOnlyFalsePositive', !reference, {
            referenceOnly: reference,
          }),
        ],
        task: context.task,
      })

      expect(result.artifacts?.runnerStatus).toBe('completed')
      expect(result.output.runId).toBe(`live:${routerTask.id}`)
      expect(result.artifacts?.transcriptPath).toEqual(expect.any(String))
      expect(result.artifacts?.commandsInvoked).toEqual(expect.any(Array))
      expect(result.artifacts?.loadedSkills).toEqual(expect.any(Array))
    },
    300_000,
  )
})

async function withoutCopilotCommand<T>(run: () => Promise<T>): Promise<T> {
  const previousCommand = process.env.INTENT_DISCOVERY_COPILOT_COMMAND

  delete process.env.INTENT_DISCOVERY_COPILOT_COMMAND

  try {
    return await run()
  } finally {
    if (previousCommand !== undefined) {
      process.env.INTENT_DISCOVERY_COPILOT_COMMAND = previousCommand
    }
  }
}

async function runLiveHarness(
  task: IntentDiscoveryTask,
): Promise<HarnessRun<LiveCopilotOutput>> {
  const artifacts: HarnessContext['artifacts'] = {}
  const context: HarnessContext = {
    artifacts,
    setArtifact(name, value) {
      artifacts[name] = value
    },
  }

  return liveCopilotHarness.run(task, context) as Promise<
    HarnessRun<LiveCopilotOutput>
  >
}
