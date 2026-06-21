import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parseIntentCommand } from './parse-intent-commands'
import { prepareGateRun } from './prepare-copilot-home'
import type { GateRun } from './prepare-copilot-home'
import type { IntentDiscoveryTask } from '../corpus/tasks'
import type {
  NormalizedMessage,
  ToolCallRecord,
  UsageSummary,
} from 'vitest-evals'

const evalDir = dirname(dirname(fileURLToPath(import.meta.url)))
const transcriptDir = join(evalDir, 'runs', 'latest', 'transcripts')
const commandTimeoutMs = Number(
  process.env.INTENT_DISCOVERY_COMMAND_TIMEOUT_MS ?? '300000',
)

export class LiveCopilotRunnerUnavailableError extends Error {
  constructor() {
    super(
      'Live Copilot runner is not wired yet. Use saved transcripts until the runner can launch Copilot and capture transcript, command, and diff evidence.',
    )
    this.name = 'LiveCopilotRunnerUnavailableError'
  }
}

export type RunCopilotTaskInput = {
  task: IntentDiscoveryTask
  runId: string
  sourcePath: string
  workspacePath: string
}

export type CopilotTaskRun = {
  finalAnswer: string
  runId: string
  messages: Array<NormalizedMessage>
  toolCalls: Array<ToolCallRecord>
  usage?: UsageSummary
  transcriptPath?: string
  commandsInvoked: Array<string>
  intentCommandsInvoked: Array<string>
  intentCommandOutputs: Array<string>
  loadedSkills: Array<string>
  fileDiff?: string
  agentErrors: Array<string>
}

export async function runCopilotTask(
  input: RunCopilotTaskInput,
): Promise<CopilotTaskRun> {
  const command = process.env.INTENT_DISCOVERY_COPILOT_COMMAND

  if (!command) {
    throw new LiveCopilotRunnerUnavailableError()
  }

  const gateState =
    input.task.condition === 'hooked-intent'
      ? prepareGateRun(sanitizeFileName(input.runId))
      : undefined

  const result = await runCommand({ command, input, gateState })
  const transcript = transcriptFromCommandResult(result)
  const transcriptPath = writeTranscript(input.runId, transcript)
  const intentCommandCaptures = captureIntentCommands(transcript)
  const fileDiff = await collectFileDiff(input.sourcePath, input.workspacePath)
  const agentErrors =
    result.exitCode === 0 ? [] : [result.stderr || result.stdout]

  return {
    finalAnswer: finalAnswerFromTranscript(transcript),
    runId: input.runId,
    messages: [
      {
        role: 'user',
        content: input.task.prompt,
      },
      {
        role: 'tool',
        content: transcript,
      },
      {
        role: 'assistant',
        content: finalAnswerFromTranscript(transcript),
        toolCalls: intentCommandCaptures.map((capture) => capture.toolCall),
      },
    ],
    toolCalls: intentCommandCaptures.map((capture) => capture.toolCall),
    usage: {
      provider: 'copilot-command',
      model: process.env.INTENT_DISCOVERY_COPILOT_MODEL ?? 'unknown',
    },
    transcriptPath,
    commandsInvoked: intentCommandCaptures.map((capture) => capture.command),
    intentCommandsInvoked: intentCommandCaptures.map(
      (capture) => capture.command,
    ),
    intentCommandOutputs: intentCommandCaptures.map(
      (capture) => capture.output,
    ),
    loadedSkills: [
      ...new Set(
        intentCommandCaptures
          .map((capture) => capture.skillUse)
          .filter((skillUse): skillUse is string => Boolean(skillUse)),
      ),
    ],
    fileDiff,
    agentErrors,
  }
}

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

type IntentCommandCapture = {
  command: string
  output: string
  skillUse?: string
  toolCall: ToolCallRecord
}

async function runCommand({
  command,
  input,
  gateState,
}: {
  command: string
  input: RunCopilotTaskInput
  gateState?: GateRun
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, {
      cwd: input.workspacePath,
      shell: true,
      env: {
        ...process.env,
        ...(gateState
          ? {
              COPILOT_HOME: gateState.copilotHome,
              INTENT_DISCOVERY_GATE_STATE: gateState.stateFile,
            }
          : {}),
        INTENT_DISCOVERY_TASK_ID: input.task.id,
        INTENT_DISCOVERY_FIXTURE: input.task.fixture,
        INTENT_DISCOVERY_PROMPT: input.task.prompt,
        INTENT_DISCOVERY_RUN_ID: input.runId,
        INTENT_DISCOVERY_WORKSPACE: input.workspacePath,
      },
    })
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`Copilot command timed out after ${commandTimeoutMs}ms`))
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
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
      })
    })
  })
}

function transcriptFromCommandResult(result: CommandResult): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
}

function finalAnswerFromTranscript(transcript: string): string {
  const finalAnswerLine = transcript
    .split('\n')
    .find((line) => line.startsWith('FINAL_ANSWER:'))

  return finalAnswerLine?.replace(/^FINAL_ANSWER:\s*/, '') ?? transcript.trim()
}

function writeTranscript(runId: string, transcript: string): string {
  mkdirSync(transcriptDir, { recursive: true })
  const transcriptPath = join(transcriptDir, `${sanitizeFileName(runId)}.txt`)

  writeFileSync(transcriptPath, transcript)

  return transcriptPath
}

function captureIntentCommands(
  transcript: string,
): Array<IntentCommandCapture> {
  const lines = transcript.split('\n')
  const captures: Array<IntentCommandCapture> = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const command = parseIntentCommand(line ?? '', 'tool-message')

    if (!command) {
      continue
    }

    const output = outputAfterCommand(lines, index)

    captures.push({
      command: command.raw,
      output,
      skillUse: command.skillUse,
      toolCall: {
        name: 'shell_command',
        arguments: {
          command: command.raw,
        },
        result: output,
      },
    })
  }

  return captures
}

function outputAfterCommand(
  lines: Array<string>,
  commandIndex: number,
): string {
  const output: Array<string> = []

  for (let index = commandIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (parseIntentCommand(line, 'tool-message')) {
      break
    }

    output.push(line)
  }

  return output.join('\n').trim()
}

async function collectFileDiff(
  sourcePath: string,
  workspacePath: string,
): Promise<string> {
  const result = await runDiff(sourcePath, workspacePath)

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return result.stderr
  }

  return result.stdout
}

async function runDiff(
  sourcePath: string,
  workspacePath: string,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn('diff', ['-ruN', sourcePath, workspacePath])
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`diff timed out after ${commandTimeoutMs}ms`))
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
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
      })
    })
  })
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9.-]+/gi, '-')
}
