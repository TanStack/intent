import type {
  IntentDiscoveryCondition,
  PromptExplicitnessLevel,
} from './conditions'

const expectedSkillAreas = ['router', 'start', 'table-v9'] as const

export type ExpectedSkillArea = (typeof expectedSkillAreas)[number]

export type IntentDiscoveryFixture =
  | 'router-basic'
  | 'start-basic'
  | 'table-v9-basic'

export type IntentDiscoveryFailureClass =
  | 'strict-success'
  | 'no-discovery-attempt'
  | 'instruction-ignored'
  | 'wrong-surface'
  | 'command-unknown'
  | 'command-attempted-but-failed'
  | 'wrong-skill-selected'
  | 'late-load'
  | 'reference-only'
  | 'final-output-only'
  | 'context-saturation'
  | 'prompt-too-vague'
  | 'harness-error'

type IntentDiscoveryExpected = {
  strictInvocation: boolean
  correctSkillLoaded: boolean
  referenceOnly: boolean
  failureClass: IntentDiscoveryFailureClass
}

export type IntentDiscoveryTask = {
  id: string
  fixture: IntentDiscoveryFixture
  condition: IntentDiscoveryCondition
  explicitnessLevel: PromptExplicitnessLevel
  prompt: string
  expectedSkillAreas: Array<ExpectedSkillArea>
  expected: IntentDiscoveryExpected
}

export const tasks: Array<IntentDiscoveryTask> = [
  {
    id: 'router-current-intent-loads-router',
    fixture: 'router-basic',
    condition: 'current-intent',
    explicitnessLevel: 2,
    prompt: 'Add a route that loads user data before rendering the page.',
    expectedSkillAreas: ['router'],
    expected: {
      strictInvocation: true,
      correctSkillLoaded: true,
      referenceOnly: false,
      failureClass: 'strict-success',
    },
  },
  {
    id: 'router-plain-docs-reference-only',
    fixture: 'router-basic',
    condition: 'plain-docs',
    explicitnessLevel: 2,
    prompt: 'Add a route that loads user data before rendering the page.',
    expectedSkillAreas: ['router'],
    expected: {
      strictInvocation: false,
      correctSkillLoaded: false,
      referenceOnly: true,
      failureClass: 'reference-only',
    },
  },
  {
    id: 'table-v9-current-intent-loads-wrong-skill',
    fixture: 'table-v9-basic',
    condition: 'current-intent',
    explicitnessLevel: 2,
    prompt: 'Add a TanStack Table v9 column with sortable user roles.',
    expectedSkillAreas: ['table-v9'],
    expected: {
      strictInvocation: true,
      correctSkillLoaded: false,
      referenceOnly: false,
      failureClass: 'wrong-skill-selected',
    },
  },
]
