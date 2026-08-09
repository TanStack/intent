import { skillUse } from '../corpus/skill-uses'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'

type DeliveryCondition = Extract<
  IntentDiscoveryCondition,
  | 'hooked-exact-intent'
  | 'hooked-intent'
  | 'mapped-exact-intent'
  | 'mapped-intent'
  | 'no-intent'
  | 'symlink-intent'
>

export type ScoredSessionTurn = {
  id: string
  kind: 'related' | 'unrelated'
  catalogCommands: Array<string>
  expectedSkillArea?: ExpectedSkillArea
  hookCatalogInjections: number
  intentLoadAttempts: Array<{
    skillUse: string
    status: 'denied' | 'failed' | 'successful'
  }>
  intentLoads: Array<string>
  nativeSkills: Array<string>
  runnerCompleted: boolean
  taskPassed: boolean
}

export type SessionScore = {
  agentCatalogCount: number
  catalogCorrect: boolean
  deniedSkillLoads: number
  duplicateSkillLoads: number
  failedSkillLoads: number
  hookCatalogInjections: number
  missedSkillLoads: number
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
  unnecessarySkillLoads: number
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
  let deniedSkillLoads = 0
  let duplicateSkillLoads = 0
  let failedSkillLoads = 0
  let missedSkillLoads = 0
  let relatedCorrect = 0
  let unrelatedCorrect = 0
  let unnecessarySkillLoads = 0
  let wrongSkillLoads = 0

  const turnResults = turns.map((turn) => {
    const expectedUse = turn.expectedSkillArea
      ? skillUse(turn.expectedSkillArea)
      : undefined
    const active =
      condition === 'symlink-intent' ? turn.nativeSkills : turn.intentLoads
    const inactive =
      condition === 'symlink-intent' ? turn.intentLoads : turn.nativeSkills
    const successfulAttempts = turn.intentLoadAttempts.filter(
      (attempt) => attempt.status === 'successful',
    )
    const duplicateLoads = Math.max(
      0,
      successfulAttempts.length - turn.intentLoads.length,
    )
    deniedSkillLoads += turn.intentLoadAttempts.filter(
      (attempt) => attempt.status === 'denied',
    ).length
    failedSkillLoads += turn.intentLoadAttempts.filter(
      (attempt) => attempt.status === 'failed',
    ).length
    duplicateSkillLoads += duplicateLoads
    if (expectedUse && !active.includes(expectedUse)) missedSkillLoads++
    if (expectedUse) {
      wrongSkillLoads += [...active, ...inactive].filter(
        (use) => use !== expectedUse,
      ).length
    } else {
      unnecessarySkillLoads += active.length + inactive.length
    }
    const discoveryCorrect =
      condition === 'no-intent'
        ? active.length === 0 && inactive.length === 0
        : expectedUse
          ? active.length === 1 &&
            active[0] === expectedUse &&
            inactive.length === 0 &&
            duplicateLoads === 0
          : active.length === 0 && inactive.length === 0

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
    deniedSkillLoads,
    duplicateSkillLoads,
    failedSkillLoads,
    hookCatalogInjections,
    missedSkillLoads,
    passed: catalogCorrect && turnResults.every((turn) => turn.passed),
    relatedCorrect,
    relatedTotal: turns.filter((turn) => turn.kind === 'related').length,
    runnerCompletionCount: turns.filter((turn) => turn.runnerCompleted).length,
    taskCompletionCount: turns.filter((turn) => turn.taskPassed).length,
    turnResults,
    unrelatedCorrect,
    unrelatedTotal: turns.filter((turn) => turn.kind === 'unrelated').length,
    unnecessarySkillLoads,
    wrongSkillLoads,
  }
}

function catalogBehaviorIsCorrect(
  condition: DeliveryCondition,
  turns: Array<ScoredSessionTurn>,
): boolean {
  if (condition === 'mapped-intent' || condition === 'mapped-exact-intent') {
    return turns.every((turn) => turn.catalogCommands.length === 0)
  }

  if (condition === 'hooked-intent' || condition === 'hooked-exact-intent') {
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
