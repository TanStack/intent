import { createHarness } from 'vitest-evals'
import type { NormalizedMessage, ToolCallRecord } from 'vitest-evals'
import type { SavedTranscriptCase } from '../fixtures/saved-transcripts'

export type IntentDiscoveryOutput = {
  finalAnswer: string
  runId: string
}

export const savedTranscriptHarness = createHarness<
  SavedTranscriptCase,
  IntentDiscoveryOutput
>({
  name: 'intent-discovery-saved-transcript',
  run: ({ input, setArtifact }) => {
    const runId = `saved:${input.id}`

    setArtifact('runId', runId)
    setArtifact('taskId', input.id)
    setArtifact('condition', input.condition)
    setArtifact('fixture', input.fixture)
    setArtifact('prompt', input.prompt)
    setArtifact('expectedSkillAreas', input.expectedSkillAreas)
    setArtifact(
      'transcriptPath',
      'evals/intent-discovery/fixtures/saved-transcripts.ts',
    )
    setArtifact('commandsInvoked', input.commandsInvoked)
    setArtifact('intentCommandsInvoked', input.intentCommandsInvoked)
    setArtifact('intentCommandOutputs', input.intentCommandOutputs)
    setArtifact('loadedSkills', input.loadedSkills)
    setArtifact('agentErrors', input.agentErrors)

    return {
      output: {
        finalAnswer: input.finalAnswer,
        runId,
      },
      messages: messagesWithToolCalls(input.messages, input.toolCalls),
      toolCalls: input.toolCalls,
      usage: {
        provider: 'saved-transcript',
        model: 'synthetic',
      },
      artifacts: {
        runKind: 'saved-transcript',
      },
      traces: [
        {
          id: runId,
          name: 'saved transcript grading',
          spans: [
            {
              id: `${runId}:load`,
              name: 'load saved transcript',
              kind: 'custom',
              status: 'ok',
              attributes: {
                taskId: input.id,
                fixture: input.fixture,
                condition: input.condition,
              },
            },
          ],
        },
      ],
      errors: input.agentErrors,
    }
  },
})

function messagesWithToolCalls(
  messages: Array<NormalizedMessage>,
  toolCalls: Array<ToolCallRecord>,
): Array<NormalizedMessage> {
  if (toolCalls.length === 0) {
    return messages
  }

  const firstAssistantIndex = messages.findIndex(
    (message) => message.role === 'assistant',
  )

  if (firstAssistantIndex === -1) {
    return [
      ...messages,
      {
        role: 'assistant',
        toolCalls,
      },
    ]
  }

  return messages.map((message, index) =>
    index === firstAssistantIndex
      ? {
          ...message,
          toolCalls: mergeToolCalls(message.toolCalls ?? [], toolCalls),
        }
      : message,
  )
}

function mergeToolCalls(
  existing: Array<ToolCallRecord>,
  incoming: Array<ToolCallRecord>,
): Array<ToolCallRecord> {
  const seen = new Set(
    existing.map(
      (call) => `${call.name}:${JSON.stringify(call.arguments ?? {})}`,
    ),
  )

  return [
    ...existing,
    ...incoming.filter((call) => {
      const key = `${call.name}:${JSON.stringify(call.arguments ?? {})}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    }),
  ]
}
