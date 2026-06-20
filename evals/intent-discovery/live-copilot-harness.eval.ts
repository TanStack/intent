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
