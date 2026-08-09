import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { scoreLiveSession } from '../graders/session-scoring'
import { extractTurnEvidence } from './session-events'
import { prepareCopilotRun } from './prepare-copilot-home'
import { resolveRunsDir } from './run-paths'
import { validateSessionTurn } from './validate-session-turn'
import type { LiveSessionCase } from '../corpus/live-sessions'
import type {
  ScoredSessionTurn,
  SessionScore,
} from '../graders/session-scoring'
import type { ModelCacheState, TurnEvidence } from './session-events'
import type { CopilotRun } from './prepare-copilot-home'
import type { NormalizedMessage, ToolCallRecord } from 'vitest-evals'

const commandTimeoutMs = Number(
  process.env.INTENT_DISCOVERY_COMMAND_TIMEOUT_MS ?? '300000',
)
export class LiveCopilotRunnerUnavailableError extends Error {
  constructor() {
    super(
      'Live Copilot runner is not wired. Set INTENT_DISCOVERY_COPILOT_COMMAND.',
    )
    this.name = 'LiveCopilotRunnerUnavailableError'
  }
}

export type CopilotSessionTurn = ScoredSessionTurn &
  TurnEvidence & {
    durationMs: number
    exitCode: number | null
    hookCommandDurationMs: number
    hookExactCommandOutputs: number
    hookExitedSuccessfully: number
    hookInjectedBytes: number
    hookInvocations: number
    hookOmittedSkillCount: number
    hookRepresentedSkillCount: number
    hookSubagentCatalogInjections: number
    hookValidOutputs: number
    prompt: string
    stderr: string
    transcriptPath: string
    validationReason: string
  }

export type CopilotSessionRun = {
  agentErrors: Array<string>
  cacheStatus: 'not-observable' | 'observed'
  copilotVersion: string
  fileDiff: string
  hookContexts: Array<string>
  messages: Array<NormalizedMessage>
  modelCacheState: Array<ModelCacheState>
  runId: string
  score: SessionScore
  sessionId: string
  toolCalls: Array<ToolCallRecord>
  turns: Array<CopilotSessionTurn>
}

export async function runCopilotSession({
  input,
  runId,
  sourcePath,
  workspacePath,
}: {
  input: LiveSessionCase
  runId: string
  sourcePath: string
  workspacePath: string
}): Promise<CopilotSessionRun> {
  const command = process.env.INTENT_DISCOVERY_COPILOT_COMMAND
  if (!command) throw new LiveCopilotRunnerUnavailableError()

  const sessionId = randomUUID()
  const copilotRun = prepareCopilotRun({
    condition: input.condition,
    runId: sanitizeFileName(runId),
    workspacePath,
  })
  const eventPath = join(
    copilotRun.copilotHome,
    'session-state',
    sessionId,
    'events.jsonl',
  )
  const turns: Array<CopilotSessionTurn> = []
  const agentErrors: Array<string> = []
  const hookContexts = new Set<string>()
  const modelCacheStateByModel = new Map<string, ModelCacheState>()
  let copilotVersion = ''
  let eventOffset = 0
  let hookOffset = 0

  for (const [turnIndex, turn] of input.turns.entries()) {
    const startedAt = Date.now()
    const result = await runCommand({
      command,
      copilotRun,
      input,
      runId,
      sessionId,
      turnId: turn.id,
      prompt: turn.prompt,
      workspacePath,
    })
    let evidence = emptyTurnEvidence()
    let evidenceError = ''
    let hookDelta: {
      nextOffset: number
      values: Array<Record<string, unknown>>
    } = { nextOffset: hookOffset, values: [] }
    try {
      const eventDelta = readJsonLines(eventPath, eventOffset)
      hookDelta = copilotRun.hookStateFile
        ? readJsonLines(copilotRun.hookStateFile, hookOffset)
        : { nextOffset: 0, values: [] }
      eventOffset = eventDelta.nextOffset
      hookOffset = hookDelta.nextOffset
      evidence = extractTurnEvidence(eventDelta.values)
      if (!evidence.finalAnswer || !evidence.model) {
        throw new Error('incomplete structured event evidence')
      }
    } catch (error) {
      evidenceError = `${turn.id}: ${error instanceof Error ? error.message : String(error)}`
    }
    if (evidence.copilotVersion) copilotVersion = evidence.copilotVersion
    for (const cacheState of evidence.modelCacheState) {
      modelCacheStateByModel.set(cacheState.modelId, cacheState)
    }
    const validation = evidenceError
      ? { passed: false, reason: evidenceError }
      : validateSessionTurn(workspacePath, turn)
    const runnerCompleted = result.exitCode === 0 && !evidenceError
    const hookInjections = hookDelta.values.flatMap((value) => {
      const injection = readCatalogInjection(value)
      return injection ? [injection] : []
    })
    for (const injection of hookInjections) {
      hookContexts.add(injection.context)
    }
    const sessionHookInjections = hookInjections.filter(
      (injection) => injection.lifecycleEventName === 'SessionStart',
    )
    const subagentHookInjections = hookInjections.filter(
      (injection) => injection.lifecycleEventName === 'SubagentStart',
    )
    const hookCatalogInjections = sessionHookInjections.length

    if (evidenceError) {
      agentErrors.push(evidenceError)
    } else if (!runnerCompleted) {
      agentErrors.push(
        `${turn.id}: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
      )
    }

    turns.push({
      ...evidence,
      id: turn.id,
      kind: turn.kind,
      ...(turn.expectedSkillArea
        ? { expectedSkillArea: turn.expectedSkillArea }
        : {}),
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      hookCatalogInjections,
      hookCommandDurationMs: hookDelta.values.reduce(
        (total, value) => total + numberValue(value.commandDurationMs),
        0,
      ),
      hookExactCommandOutputs: hookInjections.filter(
        (injection) => injection.exactLoadCommands,
      ).length,
      hookExitedSuccessfully: hookDelta.values.filter(
        (value) => value.exitCode === 0,
      ).length,
      hookInjectedBytes: hookInjections.reduce(
        (total, injection) => total + injection.contextBytes,
        0,
      ),
      hookInvocations: hookDelta.values.length,
      hookOmittedSkillCount: sessionHookInjections.reduce(
        (total, injection) => total + injection.omittedSkillCount,
        0,
      ),
      hookRepresentedSkillCount: sessionHookInjections.reduce(
        (total, injection) => total + injection.representedSkillCount,
        0,
      ),
      hookSubagentCatalogInjections: subagentHookInjections.length,
      hookValidOutputs: hookInjections.length,
      prompt: turn.prompt,
      runnerCompleted,
      stderr: result.stderr,
      taskPassed: validation.passed,
      transcriptPath: join(
        workspacePath,
        '.intent-eval',
        `${sanitizeFileName(runId)}-${sanitizeFileName(turn.id)}.md`,
      ),
      validationReason: validation.reason,
    })
    if (turnIndex < input.turns.length - 1 && !runnerCompleted) break
  }

  const score = scoreLiveSession(input.condition, turns)
  const modelCacheState = [...modelCacheStateByModel.values()].sort(
    (left, right) => left.modelId.localeCompare(right.modelId),
  )

  const run = {
    agentErrors,
    cacheStatus:
      modelCacheState.length > 0
        ? ('observed' as const)
        : ('not-observable' as const),
    copilotVersion: copilotVersion || 'not-observable',
    fileDiff: await collectFileDiff(sourcePath, workspacePath),
    hookContexts: [...hookContexts],
    messages: turns.flatMap((turn) => [
      { role: 'user' as const, content: turn.prompt },
      { role: 'assistant' as const, content: turn.finalAnswer },
    ]),
    modelCacheState,
    runId,
    score,
    sessionId,
    toolCalls: turns.flatMap(turnToolCalls),
    turns,
  }

  writeSessionResult(run, input)

  return run
}

function emptyTurnEvidence(): TurnEvidence {
  return {
    catalogCommands: [],
    copilotVersion: '',
    finalAnswer: '',
    hookContextBytes: 0,
    hookContextReceipts: 0,
    intentLoadAttempts: [],
    intentLoads: [],
    model: '',
    modelCacheState: [],
    nativeSkills: [],
    shellCommands: [],
  }
}

type CommandResult = {
  exitCode: number | null
  stderr: string
  stdout: string
}

async function runCommand({
  command,
  copilotRun,
  input,
  prompt,
  runId,
  sessionId,
  turnId,
  workspacePath,
}: {
  command: string
  copilotRun: CopilotRun
  input: LiveSessionCase
  prompt: string
  runId: string
  sessionId: string
  turnId: string
  workspacePath: string
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, {
      cwd: workspacePath,
      shell: true,
      env: {
        ...process.env,
        COPILOT_HOME: copilotRun.copilotHome,
        ...(copilotRun.hookCommand
          ? { INTENT_DISCOVERY_HOOK_COMMAND: copilotRun.hookCommand }
          : {}),
        ...(copilotRun.hookContextFormat
          ? {
              INTENT_DISCOVERY_HOOK_CONTEXT_FORMAT:
                copilotRun.hookContextFormat,
            }
          : {}),
        ...(copilotRun.hookMaxContextBytes
          ? {
              INTENT_DISCOVERY_HOOK_MAX_BYTES: String(
                copilotRun.hookMaxContextBytes,
              ),
            }
          : {}),
        ...(copilotRun.hookStateFile
          ? { INTENT_DISCOVERY_HOOK_STATE: copilotRun.hookStateFile }
          : {}),
        INTENT_DISCOVERY_COPILOT_MODEL: input.profile.model,
        INTENT_DISCOVERY_FIXTURE: input.fixture,
        INTENT_DISCOVERY_PROMPT: prompt,
        INTENT_DISCOVERY_REASONING_EFFORT: input.profile.effort,
        INTENT_DISCOVERY_RUN_ID: runId,
        INTENT_DISCOVERY_SESSION_ID: sessionId,
        INTENT_DISCOVERY_TASK_ID: `${input.id}:${turnId}`,
        INTENT_DISCOVERY_TURN_ID: turnId,
        INTENT_DISCOVERY_WORKSPACE: workspacePath,
      },
    })
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`Copilot turn timed out after ${commandTimeoutMs}ms`))
    }, commandTimeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode,
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
      })
    })
  })
}

function readJsonLines(
  filePath: string,
  offset: number,
): { nextOffset: number; values: Array<Record<string, unknown>> } {
  if (!existsSync(filePath)) {
    return { nextOffset: offset, values: [] }
  }

  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  return {
    nextOffset: lines.length,
    values: lines.slice(offset).map((line) => {
      const parsed = JSON.parse(line) as unknown
      if (!isRecord(parsed)) throw new Error('Expected a JSON object event')
      return parsed
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readCatalogInjection(value: Record<string, unknown>): {
  context: string
  contextBytes: number
  exactLoadCommands: boolean
  lifecycleEventName: 'SessionStart' | 'SubagentStart' | 'unknown'
  omittedSkillCount: number
  representedSkillCount: number
} | null {
  if (value.exitCode !== 0 || typeof value.stdout !== 'string') return null
  try {
    const output = JSON.parse(value.stdout) as { additionalContext?: unknown }
    if (
      typeof output.additionalContext !== 'string' ||
      !output.additionalContext.includes('Available Intent skills:')
    ) {
      return null
    }
    return {
      context: output.additionalContext,
      contextBytes: Buffer.byteLength(output.additionalContext),
      exactLoadCommands: value.exactLoadCommands === true,
      lifecycleEventName:
        value.lifecycleEventName === 'SessionStart' ||
        value.lifecycleEventName === 'SubagentStart'
          ? value.lifecycleEventName
          : 'unknown',
      omittedSkillCount: numberValue(value.omittedSkillCount),
      representedSkillCount: numberValue(value.representedSkillCount),
    }
  } catch {
    return null
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function turnToolCalls(turn: CopilotSessionTurn): Array<ToolCallRecord> {
  return [
    ...turn.shellCommands.map((command) => ({
      name: 'shell_command',
      arguments: { command },
    })),
    ...turn.nativeSkills.map((use) => ({
      name: 'skill',
      arguments: { use },
    })),
  ]
}

function writeSessionResult(
  run: CopilotSessionRun,
  input: LiveSessionCase,
): void {
  const sessionResultDir = join(resolveRunsDir(), 'latest', 'sessions')
  mkdirSync(sessionResultDir, { recursive: true })
  writeFileSync(
    join(sessionResultDir, `${sanitizeFileName(run.runId)}.json`),
    `${JSON.stringify(
      {
        agentErrors: run.agentErrors,
        cacheStatus: run.cacheStatus,
        condition: input.condition,
        copilotVersion: run.copilotVersion,
        hookContexts: run.hookContexts,
        modelCacheState: run.modelCacheState,
        profile: input.profile,
        repetition: input.repetition,
        runId: run.runId,
        score: run.score,
        sessionId: run.sessionId,
        turns: run.turns,
      },
      null,
      2,
    )}\n`,
  )
}

async function collectFileDiff(
  sourcePath: string,
  workspacePath: string,
): Promise<string> {
  const result = await spawnCommand('diff', ['-ruN', sourcePath, workspacePath])
  return result.exitCode === 0 || result.exitCode === 1
    ? result.stdout
    : result.stderr
}

function spawnCommand(
  command: string,
  args: Array<string>,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', reject)
    child.on('close', (exitCode) =>
      resolve({
        exitCode,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      }),
    )
  })
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9.-]+/gi, '-')
}
