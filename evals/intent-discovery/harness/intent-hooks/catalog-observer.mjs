#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const command = process.env.INTENT_DISCOVERY_HOOK_COMMAND
const contextFormat = process.env.INTENT_DISCOVERY_HOOK_CONTEXT_FORMAT
const maxContextBytes = Number(
  process.env.INTENT_DISCOVERY_HOOK_MAX_BYTES ?? '8000',
)
const stateFile = process.env.INTENT_DISCOVERY_HOOK_STATE
const input = readFileSync(0)
const lifecycleEventName = readLifecycleEventName(input)

if (!command) process.exit(1)

const commandStartedAt = process.hrtime.bigint()
const result = spawnSync(command, {
  cwd: process.cwd(),
  shell: true,
  input,
  encoding: 'buffer',
  env: process.env,
})
const stdout =
  result.status === 0 && contextFormat === 'exact-commands'
    ? renderExactCommands(result.stdout, maxContextBytes)
    : result.stdout
const commandDurationMs =
  Number(process.hrtime.bigint() - commandStartedAt) / 1_000_000
const contextMetrics = measureContext(stdout)

if (stateFile) {
  mkdirSync(dirname(stateFile), { recursive: true })
  appendFileSync(
    stateFile,
    `${JSON.stringify({
      exitCode: result.status,
      commandDurationMs,
      ...contextMetrics,
      lifecycleEventName,
      stderr: result.stderr.toString('utf8'),
      stdout: stdout.toString('utf8'),
    })}\n`,
  )
}

process.stdout.write(stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)

function readLifecycleEventName(value) {
  try {
    const event = JSON.parse(value.toString('utf8'))
    const explicit = event.hook_event_name ?? event.hookEventName
    if (explicit === 'SubagentStart' || explicit === 'subagentStart') {
      return 'SubagentStart'
    }
    if (typeof event.agentName === 'string') return 'SubagentStart'
    if (explicit === 'SessionStart' || explicit === 'sessionStart') {
      return 'SessionStart'
    }
    if (
      event.source === 'startup' ||
      event.source === 'new' ||
      event.source === 'resume'
    ) {
      return 'SessionStart'
    }
  } catch {}
  return 'unknown'
}

function renderExactCommands(value, maxBytes) {
  try {
    const output = JSON.parse(value.toString('utf8'))
    if (typeof output.additionalContext !== 'string') return value
    const lines = output.additionalContext.split('\n')
    const entries = lines.flatMap((line) => {
      const match = line.match(/^- (@[^\s:]+#[^\s:]+): (.+)$/)
      return match ? [{ id: match[1], description: match[2] }] : []
    })
    if (entries.length === 0) return value
    const previousOmitted = lines.reduce((count, line) => {
      const match = line.match(/^- (\d+) additional skills? omitted/)
      return match ? Number(match[1]) : count
    }, 0)
    const warningStart = lines.indexOf('Catalog warnings:')
    const footerStart = lines.findIndex((line) =>
      line.startsWith('Before substantial work,'),
    )
    const warningLines =
      warningStart === -1
        ? []
        : lines.slice(
            warningStart,
            footerStart === -1 ? lines.length : footerStart,
          )
    const selected = [...entries]
    let context = renderExactContext(selected, previousOmitted, warningLines)
    while (Buffer.byteLength(context) > maxBytes && selected.length > 0) {
      selected.pop()
      context = renderExactContext(
        selected,
        previousOmitted + entries.length - selected.length,
        warningLines,
      )
    }
    if (Buffer.byteLength(context) > maxBytes) return value
    output.additionalContext = context
    return Buffer.from(JSON.stringify(output))
  } catch {
    return value
  }
}

function renderExactContext(entries, omitted, warningLines) {
  return [
    'Available Intent skills:',
    '',
    ...entries.flatMap(({ description, id }) => [
      `- ${id}`,
      `  Use for: ${description}`,
      `  Run: npx @tanstack/intent load ${id}`,
    ]),
    ...(omitted > 0
      ? [
          `- ${omitted} additional ${omitted === 1 ? 'skill' : 'skills'} omitted; run \`intent catalog <package>\` for the relevant package.`,
        ]
      : []),
    ...(warningLines.length > 0 ? ['', ...warningLines] : []),
    '',
    'Before substantial work, run the exact command for each relevant skill listed above. If none apply, do not load a skill and continue normally.',
  ].join('\n')
}

function measureContext(value) {
  try {
    const output = JSON.parse(value.toString('utf8'))
    if (typeof output.additionalContext !== 'string') return {}
    const contextBytes = Buffer.byteLength(output.additionalContext)
    const representedSkillCount = [
      ...output.additionalContext.matchAll(/^- (@[^\s:]+#[^\s:]+)(?::|\s*$)/gm),
    ].length
    const omitted = output.additionalContext.match(
      /- (\d+) additional skills? omitted/,
    )
    return {
      approximateTokenCount: Math.ceil(contextBytes / 4),
      contextBytes,
      exactLoadCommands:
        representedSkillCount > 0 &&
        [
          ...output.additionalContext.matchAll(
            /^  Run: npx @tanstack\/intent load @[^\s]+#[^\s]+$/gm,
          ),
        ].length === representedSkillCount,
      omittedSkillCount: omitted ? Number(omitted[1]) : 0,
      representedSkillCount,
    }
  } catch {
    return {}
  }
}
