import { skillUse } from '../corpus/skill-uses'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'

type DeliveryCondition = Extract<
  IntentDiscoveryCondition,
  'hooked-intent' | 'mapped-intent' | 'no-intent' | 'symlink-intent'
>

export type ScoredSessionTurn = {
  id: string
  kind: 'related' | 'unrelated'
  catalogCommands: Array<string>
  expectedSkillArea?: ExpectedSkillArea
  hookCatalogInjections: number
  intentLoads: Array<string>
  nativeSkills: Array<string>
  runnerCompleted: boolean
  taskPassed: boolean
}

export type SessionScore = {
  agentCatalogCount: number
  catalogCorrect: boolean
  hookCatalogInjections: number
  passed: boolean
  relatedCorrect: number
  relatedTotal: number
  runnerCompletionCount: number
  taskCompletionCount: number
  turnResults: Array<{
    discoveryCorrect: boolean
    id: string
    passed: boolean
  }>
  unrelatedCorrect: number
  unrelatedTotal: number
  wrongSkillLoads: number
}

export function scoreLiveSession(
  condition: DeliveryCondition,
  turns: Array<ScoredSessionTurn>,
): SessionScore {
  const agentCatalogCount = turns.reduce(
    (count, turn) => count + turn.catalogCommands.length,
    0,
  )
  const hookCatalogInjections = turns.reduce(
    (count, turn) => count + turn.hookCatalogInjections,
    0,
  )
  const catalogCorrect = catalogBehaviorIsCorrect(condition, turns)
  let relatedCorrect = 0
  let unrelatedCorrect = 0
  let wrongSkillLoads = 0

  const turnResults = turns.map((turn) => {
    const expectedUse = turn.expectedSkillArea
      ? skillUse(turn.expectedSkillArea)
      : undefined
    const active =
      condition === 'symlink-intent' ? turn.nativeSkills : turn.intentLoads
    const inactive =
      condition === 'symlink-intent' ? turn.intentLoads : turn.nativeSkills
    const discoveryCorrect =
      condition === 'no-intent'
        ? active.length === 0 && inactive.length === 0
        : expectedUse
          ? active.length === 1 &&
            active[0] === expectedUse &&
            inactive.length === 0
          : active.length === 0 && inactive.length === 0

    wrongSkillLoads += [...active, ...inactive].filter(
      (use) => !expectedUse || use !== expectedUse,
    ).length
    if (discoveryCorrect) {
      if (turn.kind === 'related') relatedCorrect++
      else unrelatedCorrect++
    }

    return {
      discoveryCorrect,
      id: turn.id,
      passed:
        turn.runnerCompleted &&
        turn.taskPassed &&
        (condition === 'no-intent' || discoveryCorrect),
    }
  })

  return {
    agentCatalogCount,
    catalogCorrect,
    hookCatalogInjections,
    passed: catalogCorrect && turnResults.every((turn) => turn.passed),
    relatedCorrect,
    relatedTotal: turns.filter((turn) => turn.kind === 'related').length,
    runnerCompletionCount: turns.filter((turn) => turn.runnerCompleted).length,
    taskCompletionCount: turns.filter((turn) => turn.taskPassed).length,
    turnResults,
    unrelatedCorrect,
    unrelatedTotal: turns.filter((turn) => turn.kind === 'unrelated').length,
    wrongSkillLoads,
  }
}

function catalogBehaviorIsCorrect(
  condition: DeliveryCondition,
  turns: Array<ScoredSessionTurn>,
): boolean {
  if (condition === 'mapped-intent') {
    return (
      turns[0]?.catalogCommands.length === 1 &&
      turns.slice(1).every((turn) => turn.catalogCommands.length === 0)
    )
  }

  if (condition === 'hooked-intent') {
    return (
      turns.length > 0 &&
      turns.every((turn) => turn.hookCatalogInjections === 1) &&
      turns.every((turn) => turn.catalogCommands.length === 0)
    )
  }

  return (
    turns.every((turn) => turn.catalogCommands.length === 0) &&
    turns.every((turn) => turn.hookCatalogInjections === 0)
  )
}
