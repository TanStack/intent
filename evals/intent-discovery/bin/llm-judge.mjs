#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const reportPath =
  process.argv[2] ?? 'evals/intent-discovery/runs/latest/vitest-results.json'
const apiKey = process.env.OPENAI_API_KEY
const model = process.env.INTENT_DISCOVERY_LLM_JUDGE_MODEL ?? 'gpt-4o-mini'
const requestTimeoutMs = Number(
  process.env.INTENT_DISCOVERY_LLM_JUDGE_TIMEOUT_MS ?? '30000',
)

if (!apiKey) {
  console.log('Skipped LLM judge: OPENAI_API_KEY is not set.')
  process.exit(0)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const cases = reportCases(report)
const judgments = []

for (const item of cases) {
  judgments.push(await judgeCase({ apiKey, item, model }))
}

const output = {
  generatedAt: new Date().toISOString(),
  judgments,
  model,
}
const outDir = dirname(reportPath)
mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'llm-judge.json'),
  `${JSON.stringify(output, null, 2)}\n`,
)
console.log(JSON.stringify(output, null, 2))

function reportCases(report) {
  return (report.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? [])
      .filter((test) => test.meta?.eval)
      .map((test) => {
        const run = test.meta.harness?.run ?? {}
        const artifacts = run.artifacts ?? {}
        const scores = Object.fromEntries(
          (test.meta.eval.scores ?? []).map((score) => [
            score.name,
            score.score ?? 0,
          ]),
        )

        return {
          artifacts: pick(artifacts, [
            'condition',
            'expectedSkillAreas',
            'intentCommandsInvoked',
            'loadedSkills',
            'runnerStatus',
            'taskId',
          ]),
          finalAnswer: test.meta.eval.output?.finalAnswer ?? '',
          scores,
          title: test.title,
        }
      }),
  )
}

async function judgeCase({ apiKey, item, model }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  let response

  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You judge whether a coding agent output appears to apply loaded library skill guidance. You must not decide whether Intent was invoked; that is provided by deterministic scores. Return strict JSON only.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction:
                'Assess final output quality only. Return {"appliedGuidance":"yes"|"no"|"unknown","rationale":"..."}. Use unknown when evidence is insufficient.',
              item,
            }),
          },
        ],
        model,
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    })
  } catch (error) {
    return {
      deterministicScores: item.scores,
      error: `LLM judge request failed: ${String(error)}`,
      title: item.title,
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    return {
      error: await response.text(),
      title: item.title,
    }
  }

  const body = await response.json()
  const content = body.choices?.[0]?.message?.content ?? '{}'
  let judgment
  try {
    judgment = JSON.parse(content)
  } catch (error) {
    return {
      deterministicScores: item.scores,
      error: `Invalid JSON from model: ${String(error)}`,
      rawContent: content,
      title: item.title,
    }
  }

  return {
    deterministicScores: item.scores,
    judgment,
    title: item.title,
  }
}

function pick(value, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key]]),
  )
}
