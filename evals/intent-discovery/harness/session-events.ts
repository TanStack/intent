import { basename, dirname } from 'node:path'
import { createSyncAliases } from '../../../packages/intent/src/commands/sync/targets.js'
import { skillByArea } from '../corpus/skill-uses'
import { parseIntentCommands } from './parse-intent-commands'

type SessionEvent = {
  type?: unknown
  data?: unknown
}

export type TurnEvidence = {
  catalogCommands: Array<string>
  finalAnswer: string
  intentLoads: Array<string>
  model: string
  nativeSkills: Array<string>
  shellCommands: Array<string>
}

const useByAlias = new Map(
  createSyncAliases(
    Object.values(skillByArea).map((skill) => ({
      kind: 'npm',
      id: skill.packageName,
      skill: skill.name,
    })),
  ).map(({ alias, id, skill }) => [alias, `${id}#${skill}`]),
)

export function extractTurnEvidence(
  events: ReadonlyArray<SessionEvent>,
): TurnEvidence {
  const shellCommands: Array<string> = []
  const catalogCommands: Array<string> = []
  const intentLoads: Array<string> = []
  const nativeSkills: Array<string> = []
  let finalAnswer = ''
  let model = ''

  for (const event of events) {
    const data = recordValue(event.data)

    if (event.type === 'tool.execution_start') {
      if (data.toolName !== 'bash') continue
      const command = stringValue(recordValue(data.arguments).command)
      if (!command) {
        throw new Error(
          'bash tool.execution_start is missing arguments.command',
        )
      }

      shellCommands.push(command)
      for (const parsed of parseIntentCommands(command, 'tool-call')) {
        if (parsed.action === 'catalog') catalogCommands.push(parsed.raw)
        if (parsed.action === 'load' && parsed.skillUse) {
          intentLoads.push(parsed.skillUse)
        }
      }
      continue
    }

    if (event.type === 'skill.invoked') {
      const path = stringValue(data.path)
      if (!path) throw new Error('skill.invoked is missing data.path')
      const use = path ? useByAlias.get(basename(dirname(path))) : undefined
      if (use) nativeSkills.push(use)
      continue
    }

    if (event.type === 'session.model_change') {
      model = stringValue(data.newModel) ?? model
      continue
    }

    if (event.type === 'assistant.message') {
      model = stringValue(data.model) ?? model
      const content = stringValue(data.content)
      if (content) finalAnswer = content
    }
  }

  return {
    catalogCommands: [...new Set(catalogCommands)],
    finalAnswer,
    intentLoads: [...new Set(intentLoads)],
    model,
    nativeSkills: [...new Set(nativeSkills)],
    shellCommands,
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
