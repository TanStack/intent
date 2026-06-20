const intentDiscoveryConditions = [
  {
    id: 'no-intent',
    countsTowardAutonomousScore: true,
  },
  {
    id: 'plain-docs',
    countsTowardAutonomousScore: true,
  },
  {
    id: 'current-intent',
    countsTowardAutonomousScore: true,
  },
  {
    id: 'mapped-intent',
    countsTowardAutonomousScore: true,
  },
  {
    id: 'explicit-intent-control',
    countsTowardAutonomousScore: false,
  },
] as const

export type IntentDiscoveryCondition =
  (typeof intentDiscoveryConditions)[number]['id']

const promptExplicitnessLevels = [0, 1, 2, 3, 4] as const

export type PromptExplicitnessLevel = (typeof promptExplicitnessLevels)[number]

export function countsTowardAutonomousScore({
  condition,
  explicitnessLevel,
}: {
  condition: IntentDiscoveryCondition
  explicitnessLevel: PromptExplicitnessLevel
}): boolean {
  if (explicitnessLevel === 4) {
    return false
  }

  return (
    intentDiscoveryConditions.find((candidate) => candidate.id === condition)
      ?.countsTowardAutonomousScore ?? false
  )
}
