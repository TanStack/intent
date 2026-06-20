import type {
  NormalizedMessage,
  ToolCallRecord,
  UsageSummary,
} from 'vitest-evals'
import type { IntentDiscoveryTask } from '../corpus/tasks'

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
  _input: RunCopilotTaskInput,
): Promise<CopilotTaskRun> {
  throw new LiveCopilotRunnerUnavailableError()
}
