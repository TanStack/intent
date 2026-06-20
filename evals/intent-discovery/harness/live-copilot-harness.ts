import { createHarness } from 'vitest-evals'
import { intentCommandsFromToolCalls } from './parse-intent-commands'
import { prepareFixtureWorkspace } from './prepare-fixture'
import {
  LiveCopilotRunnerUnavailableError,
  runCopilotTask,
} from './run-copilot-task'
import { applyIntentCondition } from './setup-intent-condition'
import type { IntentDiscoveryTask } from '../corpus/tasks'

export type LiveCopilotOutput = {
  finalAnswer: string
  runId: string
}

export const liveCopilotHarness = createHarness<
  IntentDiscoveryTask,
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
        expectedSkillAreas: input.expectedSkillAreas,
        workspacePath: prepared.workspacePath,
      })

      setCommonArtifacts({
        input,
        runId,
        setupFilesWritten: appliedCondition.filesWritten,
        workspacePath: prepared.workspacePath,
        setArtifact,
      })

      const run = await runCopilotTask({
        task: input,
        runId,
        sourcePath: prepared.sourcePath,
        workspacePath: prepared.workspacePath,
      })
      const intentCommands = intentCommandsFromToolCalls(run.toolCalls)

      setArtifact('transcriptPath', run.transcriptPath ?? '')
      setArtifact('commandsInvoked', run.commandsInvoked)
      setArtifact(
        'intentCommandsInvoked',
        run.intentCommandsInvoked.length > 0
          ? run.intentCommandsInvoked
          : intentCommands.map((command) => command.raw),
      )
      setArtifact('intentCommandOutputs', run.intentCommandOutputs)
      setArtifact('loadedSkills', run.loadedSkills)
      setArtifact('fileDiff', run.fileDiff ?? '')
      setArtifact('agentErrors', run.agentErrors)

      return {
        output: {
          finalAnswer: run.finalAnswer,
          runId: run.runId,
        },
        messages: run.messages,
        toolCalls: run.toolCalls,
        usage: run.usage ?? {
          provider: 'copilot',
          model: 'unknown',
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
      setArtifact('commandsInvoked', [])
      setArtifact('intentCommandsInvoked', [])
      setArtifact('intentCommandOutputs', [])
      setArtifact('loadedSkills', [])
      setArtifact('fileDiff', '')
      setArtifact('agentErrors', [normalizedError.message])

      return {
        output: {
          finalAnswer: '',
          runId,
        },
        messages: [
          {
            role: 'user',
            content: input.prompt,
          },
        ],
        toolCalls: [],
        usage: {
          provider: 'copilot',
          model: 'unknown',
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
  input: IntentDiscoveryTask
  runId: string
  setupFilesWritten: Array<string>
  workspacePath: string
  setArtifact: (name: string, value: string | Array<string>) => void
}): void {
  setArtifact('runId', runId)
  setArtifact('taskId', input.id)
  setArtifact('condition', input.condition)
  setArtifact('fixture', input.fixture)
  setArtifact('prompt', input.prompt)
  setArtifact('expectedSkillAreas', input.expectedSkillAreas)
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
