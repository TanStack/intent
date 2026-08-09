import { createHarness } from 'vitest-evals'
import { measureStaticDeliveryContext } from './delivery-context'
import { prepareFixtureWorkspace } from './prepare-fixture'
import {
  LiveCopilotRunnerUnavailableError,
  runCopilotSession,
} from './run-copilot-session'
import { applyIntentCondition } from './setup-intent-condition'
import type { LiveSessionCase } from '../corpus/live-sessions'

export type LiveCopilotOutput = {
  runId: string
  sessionPassed: boolean
}

export const liveCopilotHarness = createHarness<
  LiveSessionCase,
  LiveCopilotOutput
>({
  name: 'intent-discovery-live-copilot',
  run: async ({ input, setArtifact }) => {
    const runId = `live:${input.id}`
    let prepared: ReturnType<typeof prepareFixtureWorkspace> | undefined
    setArtifact('runId', runId)
    setArtifact('taskId', input.id)
    setArtifact('condition', input.condition)
    setArtifact('fixture', input.fixture)
    setArtifact('profile', input.profile)

    try {
      prepared = prepareFixtureWorkspace({ fixture: input.fixture })
      const setupFilesWritten = applyIntentCondition({
        condition: input.condition,
        expectedSkillAreas: ['router', 'start', 'table-v9'],
        workspacePath: prepared.workspacePath,
      })
      const deliveryContext = measureStaticDeliveryContext({
        condition: input.condition,
        expectedSkillCount: 3,
        workspacePath: prepared.workspacePath,
      })

      setArtifact('deliveryContext', deliveryContext)
      setArtifact('setupFilesWritten', setupFilesWritten)
      setArtifact('workspacePath', prepared.workspacePath)

      const run = await runCopilotSession({
        input,
        runId,
        sourcePath: prepared.sourcePath,
        workspacePath: prepared.workspacePath,
      })
      setArtifact('cacheStatus', run.cacheStatus)
      setArtifact('copilotVersion', run.copilotVersion)
      setArtifact('modelCacheState', run.modelCacheState)
      setArtifact('sessionId', run.sessionId)
      setArtifact('sessionScore', run.score)
      setArtifact('turns', run.turns)
      setArtifact('fileDiff', run.fileDiff)
      setArtifact('hookContexts', run.hookContexts)

      return {
        output: {
          runId: run.runId,
          sessionPassed: run.score.passed,
        },
        messages: run.messages,
        toolCalls: run.toolCalls,
        usage: {
          provider: 'copilot-command',
          model: input.profile.model,
        },
        artifacts: {
          runKind: 'live-copilot',
          runnerStatus: 'completed',
        },
        traces: [
          {
            id: runId,
            name: 'live Copilot run',
            spans: [
              {
                id: `${runId}:copilot`,
                name: 'run Copilot task',
                kind: 'agent',
                status: 'ok',
              },
            ],
          },
        ],
        errors: run.agentErrors,
      }
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? { message: error.message, type: error.name }
          : {
              message: String(error ?? 'Unknown live Copilot runner error'),
              type: 'Error',
            }

      setArtifact('transcriptPath', '')
      setArtifact('sessionScore', {})
      setArtifact('turns', [])
      setArtifact('fileDiff', '')

      return {
        output: {
          runId,
          sessionPassed: false,
        },
        messages: [
          {
            role: 'user',
            content: input.turns.map((turn) => turn.prompt).join('\n\n'),
          },
        ],
        toolCalls: [],
        usage: {
          provider: 'copilot',
          model: input.profile.model,
        },
        artifacts: {
          runKind: 'live-copilot',
          runnerStatus:
            error instanceof LiveCopilotRunnerUnavailableError
              ? 'unsupported'
              : 'failed',
        },
        traces: [
          {
            id: runId,
            name: 'live Copilot run',
            spans: [
              {
                id: `${runId}:copilot`,
                name: 'run Copilot task',
                kind: 'agent',
                status: 'error',
                error: normalizedError,
              },
            ],
          },
        ],
        errors: [normalizedError],
      }
    } finally {
      prepared?.cleanup()
    }
  },
})
