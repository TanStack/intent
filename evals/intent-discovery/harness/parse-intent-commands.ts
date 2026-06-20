import { toolCalls } from 'vitest-evals'
import { jsonToSearchableText } from '../graders/skill-areas'
import type { HarnessRun, ToolCallRecord } from 'vitest-evals'

export type ParsedIntentCommand = {
  raw: string
  executable:
    | 'bunx @tanstack/intent'
    | 'bunx @tanstack/intent@latest'
    | 'intent'
    | 'pnpm exec intent'
    | 'pnpm dlx @tanstack/intent'
    | 'pnpm dlx @tanstack/intent@latest'
    | 'npx @tanstack/intent'
    | 'npx @tanstack/intent@latest'
    | 'yarn dlx @tanstack/intent'
    | 'yarn dlx @tanstack/intent@latest'
  action: 'list' | 'load'
  skillUse?: string
  source: 'tool-call' | 'tool-message'
}

const commandPattern =
  /^\s*\$?\s*(?:(?:cd\s+.+?\s+&&\s+))?((?:bunx\s+@tanstack\/intent(?:@latest)?)|(?:pnpm\s+exec\s+intent)|(?:pnpm\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:npx\s+@tanstack\/intent(?:@latest)?)|(?:yarn\s+dlx\s+@tanstack\/intent(?:@latest)?)|(?:intent))\s+(list|load)(?:\s+([^\s|;&]+))?/i

export function parseIntentCommand(
  raw: string,
  source: ParsedIntentCommand['source'],
): ParsedIntentCommand | undefined {
  const match = raw.match(commandPattern)

  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const executable = match[1].replace(
    /\s+/g,
    ' ',
  ) as ParsedIntentCommand['executable']
  const action = match[2].toLowerCase() as ParsedIntentCommand['action']
  const skillUse = action === 'load' ? match[3] : undefined

  if (action === 'load' && !skillUse) {
    return undefined
  }

  return {
    raw: `${executable} ${action}${skillUse ? ` ${skillUse}` : ''}`,
    executable,
    action,
    skillUse,
    source,
  }
}

export function intentCommandsFromRun(
  run: HarnessRun,
): Array<ParsedIntentCommand> {
  return [
    ...intentCommandsFromToolCalls(toolCalls(run)),
    ...intentCommandsFromToolMessages(run),
  ]
}

export function intentCommandsFromToolCalls(
  calls: Array<ToolCallRecord>,
): Array<ParsedIntentCommand> {
  return calls.flatMap((call) => {
    const command = commandFromToolCall(call)
    const parsed = command
      ? parseIntentCommand(command, 'tool-call')
      : intentCommandFromToolName(call)

    return parsed ? [parsed] : []
  })
}

export function loadedSkillUsesFromRun(run: HarnessRun): Array<string> {
  const artifactSkills = Array.isArray(run.artifacts?.loadedSkills)
    ? run.artifacts.loadedSkills.filter(
        (candidate): candidate is string => typeof candidate === 'string',
      )
    : []
  const commandSkills = intentCommandsFromRun(run)
    .filter((command) => command.action === 'load' && Boolean(command.skillUse))
    .map((command) => command.skillUse as string)

  return [...new Set([...artifactSkills, ...commandSkills])]
}

function intentCommandsFromToolMessages(
  run: HarnessRun,
): Array<ParsedIntentCommand> {
  return run.session.messages.flatMap((message) => {
    if (message.role !== 'tool') {
      return []
    }

    return jsonToSearchableText(message.content)
      .split('\n')
      .flatMap((line) => {
        const parsed = parseIntentCommand(line, 'tool-message')

        return parsed ? [parsed] : []
      })
  })
}

function commandFromToolCall(call: ToolCallRecord): string | undefined {
  return (
    stringRecordValue(call.arguments, 'command') ??
    stringRecordValue(call.arguments, 'cmd') ??
    stringRecordValue(call.arguments, 'input') ??
    stringRecordValue(call.metadata, 'command')
  )
}

function intentCommandFromToolName(
  call: ToolCallRecord,
): ParsedIntentCommand | undefined {
  if (call.name === 'intent_list') {
    return {
      raw: call.name,
      executable: 'intent',
      action: 'list',
      source: 'tool-call',
    }
  }

  if (call.name !== 'intent_load') {
    return undefined
  }

  const skillUse = stringRecordValue(call.arguments, 'use')

  if (!skillUse) {
    return undefined
  }

  return {
    raw: `${call.name} ${skillUse}`,
    executable: 'intent',
    action: 'load',
    skillUse,
    source: 'tool-call',
  }
}

function stringRecordValue(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key]

  return typeof candidate === 'string' ? candidate : undefined
}
