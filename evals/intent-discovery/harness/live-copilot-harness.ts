import { createHarness } from 'vitest-evals'
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

    try {
      prepared = prepareFixtureWorkspace({ fixture: input.fixture })
      const appliedCondition = applyIntentCondition({
        condition: input.condition,
        expectedSkillAreas: ['router', 'start', 'table-v9'],
        workspacePath: prepared.workspacePath,
      })

      setCommonArtifacts({
        input,
        runId,
        setupFilesWritten: appliedCondition.filesWritten,
        workspacePath: prepared.workspacePath,
        setArtifact,
      })

      const run = await runCopilotSession({
        input,
        runId,
        sourcePath: prepared.sourcePath,
        workspacePath: prepared.workspacePath,
      })
      setArtifact('profile', input.profile)
      setArtifact('sessionId', run.sessionId)
      setArtifact('sessionScore', run.score)
      setArtifact('turns', run.turns)
      setArtifact('fileDiff', run.fileDiff)
      setArtifact('agentErrors', run.agentErrors)

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
      const normalizedError = normalizeRunnerError(error)

      setArtifact('transcriptPath', '')
      setArtifact('profile', input.profile)
      setArtifact('sessionScore', {})
      setArtifact('turns', [])
      setArtifact('fileDiff', '')
      setArtifact('agentErrors', [normalizedError.message])

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

function setCommonArtifacts({
  input,
  runId,
  setupFilesWritten,
  workspacePath,
  setArtifact,
}: {
  input: LiveSessionCase
  runId: string
  setupFilesWritten: Array<string>
  workspacePath: string
  setArtifact: (name: string, value: string | Array<string>) => void
}): void {
  setArtifact('runId', runId)
  setArtifact('taskId', input.id)
  setArtifact('condition', input.condition)
  setArtifact('effort', input.profile.effort)
  setArtifact('fixture', input.fixture)
  setArtifact('model', input.profile.model)
  setArtifact('profileId', input.profile.id)
  setArtifact('setupFilesWritten', setupFilesWritten)
  setArtifact('workspacePath', workspacePath)
}

function normalizeRunnerError(error: unknown): {
  message: string
  type: string
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      type: error.name,
    }
  }

  return {
    message: String(error ?? 'Unknown live Copilot runner error'),
    type: 'Error',
  }
}
