import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { scoreLiveSession } from '../graders/session-scoring'
import { extractTurnEvidence } from './session-events'
import { prepareCopilotRun } from './prepare-copilot-home'
import { validateSessionTurn } from './validate-session-turn'
import type { LiveSessionCase } from '../corpus/live-sessions'
import type {
  ScoredSessionTurn,
  SessionScore,
} from '../graders/session-scoring'
import type { TurnEvidence } from './session-events'
import type { CopilotRun } from './prepare-copilot-home'
import type { NormalizedMessage, ToolCallRecord } from 'vitest-evals'

const commandTimeoutMs = Number(
  process.env.INTENT_DISCOVERY_COMMAND_TIMEOUT_MS ?? '300000',
)
const sessionResultDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'runs',
  'latest',
  'sessions',
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
    prompt: string
    stderr: string
    transcriptPath: string
    validationReason: string
  }

export type CopilotSessionRun = {
  agentErrors: Array<string>
  fileDiff: string
  messages: Array<NormalizedMessage>
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
    const eventDelta = readJsonLines(eventPath, eventOffset)
    const hookDelta = copilotRun.hookStateFile
      ? readJsonLines(copilotRun.hookStateFile, hookOffset)
      : { nextOffset: 0, values: [] }
    eventOffset = eventDelta.nextOffset
    hookOffset = hookDelta.nextOffset
    const evidence = extractTurnEvidence(eventDelta.values)
    if (!evidence.finalAnswer || !evidence.model) {
      throw new Error(`${turn.id}: incomplete structured event evidence`)
    }
    const validation = validateSessionTurn(workspacePath, turn)
    const runnerCompleted = result.exitCode === 0
    const hookCatalogInjections = hookDelta.values.filter(
      isSuccessfulCatalogInjection,
    ).length

    if (!runnerCompleted) {
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

  const run = {
    agentErrors,
    fileDiff: await collectFileDiff(sourcePath, workspacePath),
    messages: turns.flatMap((turn) => [
      { role: 'user' as const, content: turn.prompt },
      { role: 'assistant' as const, content: turn.finalAnswer },
    ]),
    runId,
    score,
    sessionId,
    toolCalls: turns.flatMap(turnToolCalls),
    turns,
  }

  writeSessionResult(run, input)

  return run
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

function isSuccessfulCatalogInjection(value: Record<string, unknown>): boolean {
  if (value.exitCode !== 0 || typeof value.stdout !== 'string') return false
  try {
    const output = JSON.parse(value.stdout) as { additionalContext?: unknown }
    return (
      typeof output.additionalContext === 'string' &&
      output.additionalContext.includes('Available Intent skills:')
    )
  } catch {
    return false
  }
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
  mkdirSync(sessionResultDir, { recursive: true })
  writeFileSync(
    join(sessionResultDir, `${sanitizeFileName(run.runId)}.json`),
    `${JSON.stringify(
      {
        agentErrors: run.agentErrors,
        condition: input.condition,
        profile: input.profile,
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
