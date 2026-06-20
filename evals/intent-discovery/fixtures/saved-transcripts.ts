import type { NormalizedMessage, SimpleToolCallRecord } from 'vitest-evals'
import type { IntentDiscoveryTask } from '../corpus/tasks'
import { tasks } from '../corpus/tasks'

export type SavedTranscriptCase = IntentDiscoveryTask & {
  finalAnswer: string
  messages: NormalizedMessage[]
  toolCalls: SimpleToolCallRecord[]
  commandsInvoked: string[]
  intentCommandsInvoked: string[]
  intentCommandOutputs: string[]
  loadedSkills: string[]
  agentErrors: string[]
}

const taskById = new Map(tasks.map((task) => [task.id, task]))

export const savedTranscriptCases: SavedTranscriptCase[] = [
  savedTranscript('router-current-intent-loads-router', {
    finalAnswer:
      'I loaded @tanstack/router#routing and used its route loader guidance before making the route change.',
    messages: [
      {
        role: 'user',
        content: 'Add a route that loads user data before rendering the page.',
      },
      {
        role: 'assistant',
        content: 'I will inspect the installed Intent skills first.',
      },
      {
        role: 'tool',
        content:
          '$ pnpm exec intent list\n@tanstack/router#routing - Router route and loader guidance',
      },
      {
        role: 'tool',
        content:
          '$ pnpm exec intent load @tanstack/router#routing\nLoaded @tanstack/router#routing',
      },
      {
        role: 'assistant',
        content:
          'I loaded @tanstack/router#routing and used its route loader guidance before making the route change.',
      },
    ],
    toolCalls: [
      {
        name: 'shell_command',
        arguments: { command: 'pnpm exec intent list' },
        result: '@tanstack/router#routing - Router route and loader guidance',
      },
      {
        name: 'shell_command',
        arguments: {
          command: 'pnpm exec intent load @tanstack/router#routing',
        },
        result: 'Loaded @tanstack/router#routing',
      },
    ],
    commandsInvoked: [
      'pnpm exec intent list',
      'pnpm exec intent load @tanstack/router#routing',
    ],
    intentCommandsInvoked: [
      'pnpm exec intent list',
      'pnpm exec intent load @tanstack/router#routing',
    ],
    intentCommandOutputs: [
      '@tanstack/router#routing - Router route and loader guidance',
      'Loaded @tanstack/router#routing',
    ],
    loadedSkills: ['@tanstack/router#routing'],
    agentErrors: [],
  }),
  savedTranscript('router-plain-docs-reference-only', {
    finalAnswer:
      'This looks like a TanStack Router loader task. I would follow the Router docs and add the loader to the route.',
    messages: [
      {
        role: 'user',
        content: 'Add a route that loads user data before rendering the page.',
      },
      {
        role: 'assistant',
        content:
          'This looks like a TanStack Router loader task. I would follow the Router docs and add the loader to the route.',
      },
    ],
    toolCalls: [],
    commandsInvoked: [],
    intentCommandsInvoked: [],
    intentCommandOutputs: [],
    loadedSkills: [],
    agentErrors: [],
  }),
  savedTranscript('query-current-intent-loads-wrong-skill', {
    finalAnswer:
      'I loaded @tanstack/router#routing, but the task needed TanStack Query mutation guidance.',
    messages: [
      {
        role: 'user',
        content:
          'Add a mutation that invalidates the user list query after save.',
      },
      {
        role: 'tool',
        content:
          '$ intent list\n@tanstack/router#routing - Router route and loader guidance\n@tanstack/query#mutations - Query mutation guidance',
      },
      {
        role: 'tool',
        content:
          '$ intent load @tanstack/router#routing\nLoaded @tanstack/router#routing',
      },
      {
        role: 'assistant',
        content:
          'I loaded @tanstack/router#routing, but the task needed TanStack Query mutation guidance.',
      },
    ],
    toolCalls: [
      {
        name: 'shell_command',
        arguments: { command: 'intent list' },
        result:
          '@tanstack/router#routing - Router route and loader guidance\n@tanstack/query#mutations - Query mutation guidance',
      },
      {
        name: 'shell_command',
        arguments: { command: 'intent load @tanstack/router#routing' },
        result: 'Loaded @tanstack/router#routing',
      },
    ],
    commandsInvoked: ['intent list', 'intent load @tanstack/router#routing'],
    intentCommandsInvoked: [
      'intent list',
      'intent load @tanstack/router#routing',
    ],
    intentCommandOutputs: [
      '@tanstack/router#routing - Router route and loader guidance\n@tanstack/query#mutations - Query mutation guidance',
      'Loaded @tanstack/router#routing',
    ],
    loadedSkills: ['@tanstack/router#routing'],
    agentErrors: [],
  }),
]

function savedTranscript(
  taskId: string,
  transcript: Omit<SavedTranscriptCase, keyof IntentDiscoveryTask>,
): SavedTranscriptCase {
  const task = taskById.get(taskId)

  if (!task) {
    throw new Error(`Unknown saved transcript task: ${taskId}`)
  }

  return {
    ...task,
    ...transcript,
  }
}
