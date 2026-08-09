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
  copilotVersion: string
  finalAnswer: string
  hookContextBytes: number
  hookContextReceipts: number
  intentLoadAttempts: Array<IntentLoadAttempt>
  intentLoads: Array<string>
  model: string
  modelCacheState: Array<ModelCacheState>
  nativeSkills: Array<string>
  shellCommands: Array<string>
}

export type ModelCacheState = {
  cacheExpiresAt?: string
  cacheTtlSeconds?: number
  modelId: string
}

export type IntentLoadAttempt = {
  command: string
  skillUse: string
  status: 'denied' | 'failed' | 'successful'
  toolCallId: string
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

const skillByUse = new Map(
  Object.values(skillByArea).map((skill) => [
    `${skill.packageName}#${skill.name}`,
    skill,
  ]),
)

export function extractTurnEvidence(
  events: ReadonlyArray<SessionEvent>,
): TurnEvidence {
  const shellCommands: Array<string> = []
  const catalogCommands: Array<string> = []
  const pendingLoads: Array<Omit<IntentLoadAttempt, 'status'>> = []
  const nativeSkills: Array<string> = []
  const completions = new Map<string, Record<string, unknown>>()
  let copilotVersion = ''
  let finalAnswer = ''
  let hookContextBytes = 0
  let hookContextReceipts = 0
  let model = ''
  const modelCacheState: Array<ModelCacheState> = []

  for (const event of events) {
    const data = recordValue(event.data)

    if (event.type === 'session.start') {
      copilotVersion = stringValue(data.copilotVersion) ?? copilotVersion
      continue
    }

    if (event.type === 'session.usage_checkpoint') {
      modelCacheState.push(...readModelCacheState(data.modelCacheState))
      continue
    }

    if (event.type === 'tool.execution_start') {
      const toolName = stringValue(data.toolName)
      const argumentsValue = recordValue(data.arguments)
      if (toolName === 'intent_load') {
        const skillUse = stringValue(argumentsValue.use)
        if (!skillUse) {
          throw new Error(
            'intent_load tool.execution_start is missing arguments.use',
          )
        }
        const toolCallId = stringValue(data.toolCallId)
        if (!toolCallId) {
          throw new Error(
            'intent_load tool.execution_start is missing data.toolCallId',
          )
        }
        pendingLoads.push({
          command: `intent_load ${skillUse}`,
          skillUse,
          toolCallId,
        })
        continue
      }

      if (toolName !== 'bash') continue
      const command = stringValue(argumentsValue.command)
      if (!command) {
        throw new Error(
          'bash tool.execution_start is missing arguments.command',
        )
      }

      shellCommands.push(command)
      for (const parsed of parseIntentCommands(command, 'tool-call')) {
        if (parsed.action === 'catalog') catalogCommands.push(parsed.raw)
        if (parsed.action === 'load' && parsed.skillUse) {
          const toolCallId = stringValue(data.toolCallId)
          if (!toolCallId) {
            throw new Error(
              'load tool.execution_start is missing data.toolCallId',
            )
          }
          pendingLoads.push({
            command: parsed.raw,
            skillUse: parsed.skillUse,
            toolCallId,
          })
        }
      }
      continue
    }

    if (event.type === 'tool.execution_complete') {
      const toolCallId = stringValue(data.toolCallId)
      if (!toolCallId) {
        throw new Error('tool.execution_complete is missing data.toolCallId')
      }
      completions.set(toolCallId, data)
      continue
    }

    if (event.type === 'skill.invoked') {
      const path = stringValue(data.path)
      if (!path) throw new Error('skill.invoked is missing data.path')
      const use = path ? useByAlias.get(basename(dirname(path))) : undefined
      if (use) nativeSkills.push(use)
      continue
    }

    if (event.type === 'hook.end') {
      if (data.success !== true) continue
      const context = stringValue(recordValue(data.output).additionalContext)
      if (!context) continue
      hookContextReceipts++
      hookContextBytes += Buffer.byteLength(context)
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

  const intentLoadAttempts = pendingLoads.map((attempt) => ({
    ...attempt,
    status: loadAttemptStatus(
      attempt.skillUse,
      completions.get(attempt.toolCallId),
    ),
  }))
  const intentLoads = intentLoadAttempts
    .filter((attempt) => attempt.status === 'successful')
    .map((attempt) => attempt.skillUse)

  return {
    catalogCommands: [...new Set(catalogCommands)],
    copilotVersion,
    finalAnswer,
    hookContextBytes,
    hookContextReceipts,
    intentLoadAttempts,
    intentLoads: [...new Set(intentLoads)],
    model,
    modelCacheState,
    nativeSkills: [...new Set(nativeSkills)],
    shellCommands,
  }
}

function readModelCacheState(value: unknown): Array<ModelCacheState> {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    const data = recordValue(entry)
    const modelId = stringValue(data.modelId)
    if (!modelId) return []
    const cacheExpiresAt = stringValue(data.cacheExpiresAt)
    const cacheTtlSeconds = numberValue(data.cacheTtlSeconds)
    return [
      {
        ...(cacheExpiresAt ? { cacheExpiresAt } : {}),
        ...(cacheTtlSeconds !== undefined ? { cacheTtlSeconds } : {}),
        modelId,
      },
    ]
  })
}

function loadAttemptStatus(
  skillUse: string,
  completion: Record<string, unknown> | undefined,
): IntentLoadAttempt['status'] {
  if (!completion) return 'failed'
  if (stringValue(recordValue(completion.error).code) === 'denied') {
    return 'denied'
  }

  const skill = skillByUse.get(skillUse)
  if (!skill) return 'failed'
  const result = recordValue(completion.result)
  const content =
    stringValue(result.content) ?? stringValue(result.detailedContent) ?? ''
  return content.includes(`name: "${skill.name}"`) &&
    content.includes(`description: "${skill.description}"`)
    ? 'successful'
    : 'failed'
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
