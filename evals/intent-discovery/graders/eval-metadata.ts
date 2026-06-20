import { toolCalls } from 'vitest-evals'
import type { HarnessRun, JsonValue, JudgeResult } from 'vitest-evals'

export type NamedJudgeResult = JudgeResult & { name: string }

export type RuntimeTask = {
  meta: {
    harness?: unknown
    eval?: unknown
  }
}

export function score(
  name: string,
  passed: boolean,
  metadata?: NamedJudgeResult['metadata'],
): NamedJudgeResult {
  return {
    name,
    score: passed ? 1 : 0,
    metadata,
  }
}

export function attachEvalMetadata<TOutput extends JsonValue | undefined>({
  harnessName,
  run,
  scores,
  task,
}: {
  harnessName: string
  run: HarnessRun<TOutput>
  scores: Array<NamedJudgeResult>
  task: RuntimeTask
}): void {
  const avgScore =
    scores.length === 0
      ? 0
      : scores.reduce((total, item) => total + (item.score ?? 0), 0) /
        scores.length

  task.meta.harness = {
    name: harnessName,
    run,
  }
  task.meta.eval = {
    scores,
    avgScore,
    output: run.output,
    toolCalls: toolCalls(run),
    thresholdFailed: false,
  }
}
