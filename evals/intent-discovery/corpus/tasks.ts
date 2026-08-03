import type { IntentDiscoveryCondition } from './conditions'

const expectedSkillAreas = ['router', 'start', 'table-v9'] as const

export type ExpectedSkillArea = (typeof expectedSkillAreas)[number]

export type IntentDiscoveryFixture =
  | 'multi-turn'
  | 'router-basic'
  | 'start-basic'
  | 'table-v9-basic'

export type IntentDiscoveryFailureClass =
  | 'command-attempted-but-failed'
  | 'harness-error'
  | 'no-discovery-attempt'
  | 'reference-only'
  | 'strict-success'
  | 'wrong-skill-selected'

export type IntentDiscoveryTask = {
  correctSkillLoaded: boolean
  failureClass: IntentDiscoveryFailureClass
  id: string
  fixture: IntentDiscoveryFixture
  condition: IntentDiscoveryCondition
  prompt: string
  expectedSkillAreas: Array<ExpectedSkillArea>
  referenceOnly: boolean
  strictInvocation: boolean
}
