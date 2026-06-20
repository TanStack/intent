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

export function summarizeReport(report) {
  const cases = reportCases(report)
  const byCondition = groupBy(cases, (item) => item.condition ?? 'unknown')
  const conditionSummaries = Object.fromEntries(
    [...byCondition.entries()].map(([condition, items]) => [
      condition,
      summarizeCases(items),
    ]),
  )

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      reportCases: cases.length,
      testFailures: report.numFailedTests ?? 0,
      testPasses: report.numPassedTests ?? 0,
      testSuites: report.numTotalTestSuites ?? 0,
    },
    byCondition: conditionSummaries,
    failureClasses: countBy(
      cases.map((item) => item.failureClass ?? 'unknown'),
    ),
    repeatedRuns: repeatedRunSummary(cases),
  }
}

function reportCases(report) {
  return (report.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? [])
      .filter((test) => test.meta?.eval)
      .map((test) => {
        const artifacts = test.meta.harness?.run?.artifacts ?? {}
        const scores = Object.fromEntries(
          (test.meta.eval.scores ?? []).map((score) => [
            score.name,
            score.score ?? 0,
          ]),
        )
        const firstScore = test.meta.eval.scores?.[0]

        return {
          condition: artifacts.condition,
          failureClass: firstScore?.metadata?.failureClass,
          fixture: artifacts.fixture,
          loadedSkills: artifacts.loadedSkills ?? [],
          scores,
          taskId: artifacts.taskId ?? test.title,
          title: test.title,
        }
      }),
  )
}

function summarizeCases(cases) {
  return {
    autonomousSuccessRate: rate(cases, 'AutonomousDiscoverySuccess'),
    correctSkillLoadedRate: rate(cases, 'CorrectSkillLoaded'),
    count: cases.length,
    referenceOnlyFalsePositiveRate: rate(cases, 'NoReferenceOnlyFalsePositive'),
    strictInvocationRate: rate(cases, 'StrictIntentInvocation'),
  }
}

function repeatedRunSummary(cases) {
  const liveCases = cases.filter((item) => item.title.includes('/run-'))
  const grouped = groupBy(liveCases, (item) =>
    item.title.replace(/\/run-\d+$/, ''),
  )

  return Object.fromEntries(
    [...grouped.entries()].map(([key, items]) => {
      const successes = items.map(
        (item) => item.scores.AutonomousDiscoverySuccess === 1,
      )

      return [
        key,
        {
          passAtK: successes.some(Boolean),
          passHatK: successes.every(Boolean),
          runs: items.length,
          successes: successes.filter(Boolean).length,
        },
      ]
    }),
  )
}

function formatSummaryMarkdown(summary) {
  const lines = [
    '# Intent discovery eval summary',
    '',
    `Report cases: ${summary.totals.reportCases}`,
    `Tests: ${summary.totals.testPasses} passed, ${summary.totals.testFailures} failed`,
    '',
    '## By condition',
    '',
    '| Condition | Cases | Strict invocation | Correct skill | Autonomous success | No reference-only false positive |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]

  for (const [condition, item] of Object.entries(summary.byCondition)) {
    lines.push(
      `| ${condition} | ${item.count} | ${percent(item.strictInvocationRate)} | ${percent(item.correctSkillLoadedRate)} | ${percent(item.autonomousSuccessRate)} | ${percent(item.referenceOnlyFalsePositiveRate)} |`,
    )
  }

  lines.push('', '## Failure classes', '')
  for (const [failureClass, count] of Object.entries(summary.failureClasses)) {
    lines.push(`- ${failureClass}: ${count}`)
  }

  lines.push('', '## Repeated runs', '')
  const repeated = Object.entries(summary.repeatedRuns)
  if (repeated.length === 0) {
    lines.push('No repeated live runs found.')
  } else {
    for (const [key, item] of repeated) {
      lines.push(
        `- ${key}: pass@k=${item.passAtK}, pass^k=${item.passHatK}, successes=${item.successes}/${item.runs}`,
      )
    }
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

function countBy(items) {
  return Object.fromEntries(
    [...groupBy(items, (item) => item).entries()].map(([key, values]) => [
      key,
      values.length,
    ]),
  )
}

function rate(cases, scoreName) {
  if (cases.length === 0) return 0
  return (
    cases.filter((item) => item.scores[scoreName] === 1).length / cases.length
  )
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}
