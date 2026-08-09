#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const reportPath =
  process.argv[2] ?? 'evals/intent-discovery/runs/latest/vitest-results.json'
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const summary = summarizeReport(report)
const outDir = dirname(reportPath)

mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
)
writeFileSync(join(outDir, 'summary.md'), `${formatSummaryMarkdown(summary)}\n`)
console.log(formatSummaryMarkdown(summary))

function summarizeReport(value) {
  const cases = reportCases(value)
  const liveCases = cases.filter((item) => item.runKind === 'live-copilot')
  const liveSessions = liveCases.filter(
    (item) => item.runnerStatus === 'completed' && item.sessionScore,
  )
  const byCondition = Object.fromEntries(
    [...groupBy(liveCases, (item) => item.condition).entries()].map(
      ([condition, items]) => [condition, summarizeCondition(items)],
    ),
  )
  const byProfile = liveCases.map((item) => ({
    ...summarizeCondition([item]),
    cacheStatus: item.cacheStatus,
    condition: item.condition,
    copilotVersion: item.copilotVersion,
    effort: item.effort,
    model: item.model,
    modelCacheState: item.modelCacheState,
    profileId: item.profileId,
    repetition: item.repetition,
    runId: item.runId,
    runnerStatus: item.runnerStatus,
  }))
  const turnOutcomes = Object.fromEntries(
    [
      ...groupBy(
        liveSessions.flatMap((session) =>
          session.turns.map((turn) => ({ session, turn })),
        ),
        ({ session, turn }) => `${session.condition}/${turn.id}`,
      ).entries(),
    ].map(([key, items]) => [key, summarizeTurns(items)]),
  )

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      attemptedLiveSessions: liveCases.length,
      completedLiveSessions: liveSessions.length,
      failedLiveSessions: liveCases.filter(
        (item) => item.runnerStatus === 'failed',
      ).length,
      liveSessions: liveSessions.length,
      reportCases: cases.length,
      testFailures: value.numFailedTests ?? 0,
      testPasses: value.numPassedTests ?? 0,
      testSuites: value.numTotalTestSuites ?? 0,
      unsupportedLiveSessions: liveCases.filter(
        (item) => item.runnerStatus === 'unsupported',
      ).length,
    },
    byCondition,
    byProfile,
    turnOutcomes,
  }
}

function reportCases(value) {
  return (value.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? [])
      .filter((test) => test.meta?.eval)
      .map((test) => {
        const artifacts = test.meta.harness?.run?.artifacts ?? {}
        const profile = artifacts.profile ?? {}
        const scores = Object.fromEntries(
          (test.meta.eval.scores ?? []).map((entry) => [
            entry.name,
            entry.score ?? 0,
          ]),
        )

        return {
          cacheStatus: artifacts.cacheStatus ?? 'not-observable',
          condition: artifacts.condition ?? 'unknown',
          copilotVersion: artifacts.copilotVersion ?? 'not-observable',
          deliveryContext: artifacts.deliveryContext ?? null,
          effort: profile.effort ?? artifacts.effort ?? 'unknown',
          hookContexts: artifacts.hookContexts ?? [],
          model: profile.model ?? artifacts.model ?? 'unknown',
          modelCacheState: Array.isArray(artifacts.modelCacheState)
            ? artifacts.modelCacheState
            : [],
          profileId: profile.id ?? artifacts.profileId ?? 'unknown',
          repetition: artifacts.repetition ?? 1,
          runId: artifacts.runId ?? 'unknown',
          runKind: artifacts.runKind,
          runnerStatus: artifacts.runnerStatus,
          scores,
          sessionScore: artifacts.sessionScore,
          turns: artifacts.turns ?? [],
        }
      }),
  )
}

function summarizeCondition(cases) {
  const completed = cases.filter(
    (item) => item.runnerStatus === 'completed' && item.sessionScore,
  )
  return {
    ...summarizeSessions(completed),
    attemptedSessions: cases.length,
    completedSessions: completed.length,
    failedSessions: cases.filter((item) => item.runnerStatus === 'failed')
      .length,
    unsupportedSessions: cases.filter(
      (item) => item.runnerStatus === 'unsupported',
    ).length,
  }
}

function summarizeSessions(cases) {
  const scores = cases.map((item) => item.sessionScore)
  const discoveryExpected = cases.some((item) => item.condition !== 'no-intent')
  const turns = cases.flatMap((item) => item.turns)
  const observedTurns = cases.reduce(
    (total, item) => total + item.turns.length,
    0,
  )
  return {
    agentCatalogCommands: sum(scores, 'agentCatalogCount'),
    catalogBehaviorRate: discoveryExpected
      ? rate(cases, 'CatalogBehavior')
      : null,
    discoveryExpected,
    deniedSkillLoads: sum(scores, 'deniedSkillLoads'),
    duplicateSkillLoads: sum(scores, 'duplicateSkillLoads'),
    failedSkillLoads: sum(scores, 'failedSkillLoads'),
    hookCatalogInjections: sum(scores, 'hookCatalogInjections'),
    hookContextReceipts: sum(turns, 'hookContextReceipts'),
    hookExactCommandOutputs: sum(turns, 'hookExactCommandOutputs'),
    hookExitedSuccessfully: sum(turns, 'hookExitedSuccessfully'),
    hookInvocations: sum(turns, 'hookInvocations'),
    hookSubagentCatalogInjections: sum(turns, 'hookSubagentCatalogInjections'),
    hookValidOutputs: sum(turns, 'hookValidOutputs'),
    medianHookCommandDurationMs: median(
      turns
        .map((turn) => Number(turn.hookCommandDurationMs ?? 0))
        .filter((value) => value > 0),
    ),
    medianHookOmittedSkillCount: median(
      turns
        .filter((turn) => Number(turn.hookCatalogInjections ?? 0) > 0)
        .map((turn) => Number(turn.hookOmittedSkillCount ?? 0)),
    ),
    medianHookRepresentedSkillCount: median(
      turns
        .filter((turn) => Number(turn.hookCatalogInjections ?? 0) > 0)
        .map((turn) => Number(turn.hookRepresentedSkillCount ?? 0)),
    ),
    medianInjectedBytes: median(contextByteValues(cases, turns)),
    medianTurnDurationMs: median(
      turns
        .map((turn) => Number(turn.durationMs ?? 0))
        .filter((value) => value > 0),
    ),
    missedSkillLoads: sum(scores, 'missedSkillLoads'),
    relatedDiscoveryRate: discoveryExpected
      ? ratio(scores, 'relatedCorrect', 'relatedTotal')
      : null,
    runnerCompletionRate:
      observedTurns === 0
        ? 0
        : sum(scores, 'runnerCompletionCount') / observedTurns,
    sessionSuccessRate: discoveryExpected
      ? rate(cases, 'SessionSuccess')
      : null,
    sessions: cases.length,
    strictSuccesses: discoveryExpected
      ? cases.filter((item) => item.scores.SessionSuccess === 1).length
      : null,
    taskCompletionRate:
      observedTurns === 0
        ? 0
        : sum(scores, 'taskCompletionCount') / observedTurns,
    unrelatedAbstentionRate: discoveryExpected
      ? ratio(scores, 'unrelatedCorrect', 'unrelatedTotal')
      : null,
    unnecessarySkillLoads: discoveryExpected
      ? sum(scores, 'unnecessarySkillLoads')
      : null,
    wrongSkillLoads: discoveryExpected ? sum(scores, 'wrongSkillLoads') : null,
  }
}

function contextByteValues(cases, turns) {
  const staticValues = cases
    .map((item) => Number(item.deliveryContext?.injectedBytes ?? 0))
    .filter((value) => value > 0)
  if (staticValues.length > 0) return staticValues
  return turns
    .map((turn) => Number(turn.hookInjectedBytes ?? 0))
    .filter((value) => value > 0)
}

function summarizeTurns(items) {
  const discoveryExpected = items.every(
    ({ session }) => session.condition !== 'no-intent',
  )
  let discoveryCorrect = 0
  let taskCompleted = 0

  for (const { session, turn } of items) {
    const result = session.sessionScore.turnResults?.find(
      (candidate) => candidate.id === turn.id,
    )
    if (result?.discoveryCorrect) discoveryCorrect++
    if (turn.taskPassed) taskCompleted++
  }

  return {
    agentCatalogCommands: items.reduce(
      (total, { turn }) => total + turn.catalogCommands.length,
      0,
    ),
    discoveryExpected,
    discoveryRate:
      !discoveryExpected || items.length === 0
        ? null
        : discoveryCorrect / items.length,
    hookCatalogInjections: items.reduce(
      (total, { turn }) => total + turn.hookCatalogInjections,
      0,
    ),
    sessions: items.length,
    taskCompletionRate: items.length === 0 ? 0 : taskCompleted / items.length,
  }
}

function formatSummaryMarkdown(summary) {
  const lines = [
    '# Intent discovery live session summary',
    '',
    `Live sessions: ${summary.totals.completedLiveSessions}/${summary.totals.attemptedLiveSessions} completed (${summary.totals.failedLiveSessions} failed, ${summary.totals.unsupportedLiveSessions} unsupported)`,
    `Tests: ${summary.totals.testPasses} passed, ${summary.totals.testFailures} failed`,
    '',
    '## Strict session success',
    '',
    '| Mode | Completed / attempted | Strict success | Catalog | Related discovery | Unrelated abstention | Tasks completed | Wrong | Duplicate | Failed | Denied | Agent catalogs | Hook catalogs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]

  for (const [condition, item] of Object.entries(summary.byCondition)) {
    const strictSuccess = item.discoveryExpected
      ? `${item.strictSuccesses}/${item.sessions} (${metric(item.sessionSuccessRate)})`
      : 'n/a'
    const wrongLoads = item.discoveryExpected ? item.wrongSkillLoads : 'n/a'
    lines.push(
      `| ${condition} | ${item.completedSessions}/${item.attemptedSessions} | ${strictSuccess} | ${metric(item.catalogBehaviorRate)} | ${metric(item.relatedDiscoveryRate)} | ${metric(item.unrelatedAbstentionRate)} | ${metric(item.taskCompletionRate)} | ${wrongLoads} | ${item.duplicateSkillLoads} | ${item.failedSkillLoads} | ${item.deniedSkillLoads} | ${item.agentCatalogCommands} | ${item.hookCatalogInjections} |`,
    )
  }

  lines.push(
    '',
    '## Hook transport',
    '',
    '| Mode | Invoked | Exited | Valid output | Session | Subagent | Exact commands | Reached agent | Median represented | Median omitted | Median hook | Median context |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const [condition, item] of Object.entries(summary.byCondition)) {
    lines.push(
      `| ${condition} | ${item.hookInvocations} | ${item.hookExitedSuccessfully} | ${item.hookValidOutputs} | ${item.hookCatalogInjections} | ${item.hookSubagentCatalogInjections} | ${item.hookExactCommandOutputs} | ${item.hookContextReceipts} | ${count(item.medianHookRepresentedSkillCount)} | ${count(item.medianHookOmittedSkillCount)} | ${milliseconds(item.medianHookCommandDurationMs)} | ${bytes(item.medianInjectedBytes)} |`,
    )
  }

  lines.push(
    '',
    '## By model profile',
    '',
    '| Profile | Model | Effort | Run ID | Rep | Mode | Runner | Copilot | Cache | Pass | Catalog | Related | Unrelated | Tasks |',
    '| --- | --- | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const item of summary.byProfile) {
    lines.push(
      `| ${item.profileId} | ${item.model} | ${item.effort} | ${item.runId} | ${item.repetition} | ${item.condition} | ${item.runnerStatus} | ${item.copilotVersion} | ${formatCacheState(item.cacheStatus, item.modelCacheState)} | ${item.discoveryExpected ? `${item.strictSuccesses}/${item.sessions}` : 'n/a'} | ${metric(item.catalogBehaviorRate)} | ${metric(item.relatedDiscoveryRate)} | ${metric(item.unrelatedAbstentionRate)} | ${metric(item.taskCompletionRate)} |`,
    )
  }

  lines.push(
    '',
    '## Per-turn outcomes',
    '',
    '| Mode / turn | Sessions | Discovery | Task completion | Agent catalogs | Hook catalogs |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const [key, item] of Object.entries(summary.turnOutcomes)) {
    lines.push(
      `| ${key} | ${item.sessions} | ${metric(item.discoveryRate)} | ${metric(item.taskCompletionRate)} | ${item.agentCatalogCommands} | ${item.hookCatalogInjections} |`,
    )
  }

  return lines.join('\n')
}

function groupBy(items, keyFn) {
  const grouped = new Map()
  for (const item of items) {
    const key = keyFn(item)
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }
  return grouped
}

function rate(cases, scoreName) {
  if (cases.length === 0) return 0
  return (
    cases.filter((item) => item.scores[scoreName] === 1).length / cases.length
  )
}

function ratio(items, numerator, denominator) {
  const total = items.reduce(
    (value, item) => value + Number(item[denominator] ?? 0),
    0,
  )
  if (total === 0) return 0
  return sum(items, numerator) / total
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0)
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}

function metric(value) {
  return value === null ? 'n/a' : percent(value)
}

function milliseconds(value) {
  return value === null ? 'n/a' : `${Math.round(value)} ms`
}

function bytes(value) {
  return value === null ? 'n/a' : `${Math.round(value)} B`
}

function count(value) {
  return value === null ? 'n/a' : String(value)
}

function formatCacheState(status, states) {
  if (status !== 'observed' || !Array.isArray(states)) return 'not observable'
  return states
    .map((state) =>
      typeof state.cacheTtlSeconds === 'number'
        ? `${state.modelId} (${state.cacheTtlSeconds}s TTL)`
        : state.modelId,
    )
    .join(', ')
}
