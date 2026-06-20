import type {
  IntentDiscoveryCondition,
  PromptExplicitnessLevel,
} from './conditions'

export const expectedSkillAreas = [
  'router',
  'query',
  'table',
  'form',
  'start',
] as const

export type ExpectedSkillArea = (typeof expectedSkillAreas)[number]

export type IntentDiscoveryFixture =
  | 'router-basic'
  | 'query-basic'
  | 'table-basic'
  | 'form-basic'
  | 'start-basic'
  | 'mixed-app'

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

export type IntentDiscoveryExpected = {
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
  expectedSkillAreas: ExpectedSkillArea[]
  expected: IntentDiscoveryExpected
}

export const tasks: IntentDiscoveryTask[] = [
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
    id: 'query-current-intent-loads-wrong-skill',
    fixture: 'query-basic',
    condition: 'current-intent',
    explicitnessLevel: 2,
    prompt: 'Add a mutation that invalidates the user list query after save.',
    expectedSkillAreas: ['query'],
    expected: {
      strictInvocation: true,
      correctSkillLoaded: false,
      referenceOnly: false,
      failureClass: 'wrong-skill-selected',
    },
  },
]
