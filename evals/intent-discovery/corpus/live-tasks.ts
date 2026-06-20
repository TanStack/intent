import type { IntentDiscoveryTask } from './tasks'

const routerPrompt =
  'Add a route that loads user data before rendering the page.'

export const liveTasks: Array<IntentDiscoveryTask> = [
  {
    id: 'live-router-no-intent',
    fixture: 'router-basic',
    condition: 'no-intent',
    explicitnessLevel: 2,
    prompt: routerPrompt,
    expectedSkillAreas: ['router'],
    expected: {
      strictInvocation: false,
      correctSkillLoaded: false,
      referenceOnly: true,
      failureClass: 'reference-only',
    },
  },
  {
    id: 'live-router-current-intent',
    fixture: 'router-basic',
    condition: 'current-intent',
    explicitnessLevel: 2,
    prompt: routerPrompt,
    expectedSkillAreas: ['router'],
    expected: {
      strictInvocation: true,
      correctSkillLoaded: true,
      referenceOnly: false,
      failureClass: 'strict-success',
    },
  },
  {
    id: 'live-router-mapped-intent',
    fixture: 'router-basic',
    condition: 'mapped-intent',
    explicitnessLevel: 2,
    prompt: routerPrompt,
    expectedSkillAreas: ['router'],
    expected: {
      strictInvocation: true,
      correctSkillLoaded: true,
      referenceOnly: false,
      failureClass: 'strict-success',
    },
  },
  {
    id: 'live-router-explicit-intent-control',
    fixture: 'router-basic',
    condition: 'explicit-intent-control',
    explicitnessLevel: 4,
    prompt: `${routerPrompt}\n\nRun intent list, load the relevant skill, and use the loaded guidance before changing files.`,
    expectedSkillAreas: ['router'],
    expected: {
      strictInvocation: true,
      correctSkillLoaded: true,
      referenceOnly: false,
      failureClass: 'strict-success',
    },
  },
]
