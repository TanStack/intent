import type { HarnessRun, ToolCallRecord } from 'vitest-evals'
import { toolCalls } from 'vitest-evals'
import { jsonToSearchableText } from './skill-areas'

export type StrictInvocationResult = {
  passed: boolean
  matchedCommand?: string
  source?: 'tool-call' | 'tool-message'
}

const intentToolNames = new Set(['intent_list', 'intent_load'])

const acceptedIntentCommandPattern =
  /(?:^|\s)(?:(?:pnpm\s+exec\s+intent)|(?:npx\s+@tanstack\/intent)|(?:intent))\s+(?:list|load\s+\S+)/i

export function strictIntentInvocation(
  run: HarnessRun,
): StrictInvocationResult {
  for (const call of toolCalls(run)) {
    if (intentToolNames.has(call.name)) {
      return {
        passed: true,
        matchedCommand: call.name,
        source: 'tool-call',
      }
    }

    const command = commandFromToolCall(call)

    if (command && acceptedIntentCommandPattern.test(command)) {
      return {
        passed: true,
        matchedCommand: command,
        source: 'tool-call',
      }
    }
  }

  for (const message of run.session.messages) {
    if (message.role !== 'tool') {
      continue
    }

    const content = jsonToSearchableText(message.content)
    const match = content.match(acceptedIntentCommandPattern)

    if (match?.[0]) {
      return {
        passed: true,
        matchedCommand: match[0].trim(),
        source: 'tool-message',
      }
    }
  }

  return { passed: false }
}

function commandFromToolCall(call: ToolCallRecord): string | undefined {
  return (
    stringRecordValue(call.arguments, 'command') ??
    stringRecordValue(call.arguments, 'cmd') ??
    stringRecordValue(call.arguments, 'input') ??
    stringRecordValue(call.metadata, 'command')
  )
}

function stringRecordValue(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key]

  return typeof candidate === 'string' ? candidate : undefined
}
