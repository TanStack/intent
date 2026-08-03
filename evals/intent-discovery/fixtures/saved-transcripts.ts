import type { NormalizedMessage } from 'vitest-evals'
import type { IntentDiscoveryTask } from '../corpus/tasks'

export type SavedTranscriptCase = IntentDiscoveryTask & {
  finalAnswer: string
  messages: Array<NormalizedMessage>
}

export const savedTranscriptCases: Array<SavedTranscriptCase> = [
  {
    id: 'router-mapped-intent-loads-router',
    fixture: 'router-basic',
    condition: 'mapped-intent',
    prompt: 'Add a route that loads user data before rendering the page.',
    expectedSkillAreas: ['router'],
    strictInvocation: true,
    correctSkillLoaded: true,
    referenceOnly: false,
    failureClass: 'strict-success',
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
  },
  {
    id: 'router-plain-docs-reference-only',
    fixture: 'router-basic',
    condition: 'plain-docs',
    prompt: 'Add a route that loads user data before rendering the page.',
    expectedSkillAreas: ['router'],
    strictInvocation: false,
    correctSkillLoaded: false,
    referenceOnly: true,
    failureClass: 'reference-only',
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
  },
  {
    id: 'table-v9-mapped-intent-loads-wrong-skill',
    fixture: 'table-v9-basic',
    condition: 'mapped-intent',
    prompt: 'Add a TanStack Table v9 column with sortable user roles.',
    expectedSkillAreas: ['table-v9'],
    strictInvocation: true,
    correctSkillLoaded: false,
    referenceOnly: false,
    failureClass: 'wrong-skill-selected',
    finalAnswer:
      'I loaded @tanstack/router#routing, but the task needed TanStack Table v9 column guidance.',
    messages: [
      {
        role: 'user',
        content: 'Add a TanStack Table v9 column with sortable user roles.',
      },
      {
        role: 'tool',
        content:
          '$ intent list\n@tanstack/router#routing - Router route and loader guidance\n@tanstack/table#v9-columns - TanStack Table v9 column guidance',
      },
      {
        role: 'tool',
        content:
          '$ intent load @tanstack/router#routing\nLoaded @tanstack/router#routing',
      },
      {
        role: 'assistant',
        content:
          'I loaded @tanstack/router#routing, but the task needed TanStack Table v9 column guidance.',
      },
    ],
  },
]
