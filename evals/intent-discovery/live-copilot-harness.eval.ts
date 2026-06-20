import { existsSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessContext, HarnessRun } from 'vitest-evals'
import { describe, expect, it } from 'vitest'
import { failedSpans, toolCalls } from 'vitest-evals'
import { tasks, type IntentDiscoveryTask } from './corpus/tasks'
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
    const result = await runLiveHarness(routerTask)

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
})

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
