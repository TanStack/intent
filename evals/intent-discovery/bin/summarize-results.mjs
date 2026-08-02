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

export function summarizeReport(value) {
  const cases = reportCases(value)
  const liveSessions = cases.filter(
    (item) =>
      item.runKind === 'live-copilot' &&
      item.runnerStatus === 'completed' &&
      item.sessionScore,
  )
  const byCondition = Object.fromEntries(
    [...groupBy(liveSessions, (item) => item.condition).entries()].map(
      ([condition, items]) => [condition, summarizeSessions(items)],
    ),
  )
  const byProfile = liveSessions.map((item) => ({
    ...summarizeSessions([item]),
    condition: item.condition,
    effort: item.effort,
    model: item.model,
    profileId: item.profileId,
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
      liveSessions: liveSessions.length,
      reportCases: cases.length,
      testFailures: value.numFailedTests ?? 0,
      testPasses: value.numPassedTests ?? 0,
      testSuites: value.numTotalTestSuites ?? 0,
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
          condition: artifacts.condition ?? 'unknown',
          effort: profile.effort ?? artifacts.effort ?? 'unknown',
          model: profile.model ?? artifacts.model ?? 'unknown',
          profileId: profile.id ?? artifacts.profileId ?? 'unknown',
          runKind: artifacts.runKind,
          runnerStatus: artifacts.runnerStatus,
          scores,
          sessionScore: artifacts.sessionScore,
          title: test.title,
          turns: artifacts.turns ?? [],
        }
      }),
  )
}

function summarizeSessions(cases) {
  const scores = cases.map((item) => item.sessionScore)
  return {
    agentCatalogCommands: sum(scores, 'agentCatalogCount'),
    catalogBehaviorRate: rate(cases, 'CatalogBehavior'),
    hookCatalogInjections: sum(scores, 'hookCatalogInjections'),
    relatedDiscoveryRate: ratio(scores, 'relatedCorrect', 'relatedTotal'),
    runnerCompletionRate: ratio(scores, 'runnerCompletionCount', () => 5),
    sessionSuccessRate: rate(cases, 'SessionSuccess'),
    sessions: cases.length,
    strictSuccesses: cases.filter((item) => item.scores.SessionSuccess === 1)
      .length,
    taskCompletionRate: ratio(scores, 'taskCompletionCount', () => 5),
    unrelatedAbstentionRate: ratio(
      scores,
      'unrelatedCorrect',
      'unrelatedTotal',
    ),
    wrongSkillLoads: sum(scores, 'wrongSkillLoads'),
  }
}

function summarizeTurns(items) {
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
    discoveryRate: items.length === 0 ? 0 : discoveryCorrect / items.length,
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
    `Live sessions: ${summary.totals.liveSessions}`,
    `Tests: ${summary.totals.testPasses} passed, ${summary.totals.testFailures} failed`,
    '',
    '## Strict session success',
    '',
    '| Mode | Sessions | Strict success | Catalog | Related discovery | Unrelated abstention | Tasks completed | Wrong loads | Agent catalogs | Hook catalogs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]

  for (const [condition, item] of Object.entries(summary.byCondition)) {
    lines.push(
      `| ${condition} | ${item.sessions} | ${item.strictSuccesses}/${item.sessions} (${percent(item.sessionSuccessRate)}) | ${percent(item.catalogBehaviorRate)} | ${percent(item.relatedDiscoveryRate)} | ${percent(item.unrelatedAbstentionRate)} | ${percent(item.taskCompletionRate)} | ${item.wrongSkillLoads} | ${item.agentCatalogCommands} | ${item.hookCatalogInjections} |`,
    )
  }

  lines.push(
    '',
    '## By model profile',
    '',
    '| Profile | Model | Effort | Mode | Pass | Catalog | Related | Unrelated | Tasks |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const item of summary.byProfile) {
    lines.push(
      `| ${item.profileId} | ${item.model} | ${item.effort} | ${item.condition} | ${item.strictSuccesses}/${item.sessions} | ${percent(item.catalogBehaviorRate)} | ${percent(item.relatedDiscoveryRate)} | ${percent(item.unrelatedAbstentionRate)} | ${percent(item.taskCompletionRate)} |`,
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
      `| ${key} | ${item.sessions} | ${percent(item.discoveryRate)} | ${percent(item.taskCompletionRate)} | ${item.agentCatalogCommands} | ${item.hookCatalogInjections} |`,
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
    (value, item) =>
      value +
      (typeof denominator === 'function'
        ? denominator(item)
        : Number(item[denominator] ?? 0)),
    0,
  )
  if (total === 0) return 0
  return sum(items, numerator) / total
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0)
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}
