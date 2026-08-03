import { describe, expect, it } from 'vitest'
import { failedSpans } from 'vitest-evals'
import { gradeDiscovery } from './graders/discovery'
import { attachEvalMetadata, score } from './graders/eval-metadata'
import { savedTranscriptCases } from './fixtures/saved-transcripts'
import type { HarnessRun } from 'vitest-evals'

const harnessName = 'intent-discovery-saved-transcript'

describe('Intent discovery saved transcripts', () => {
  for (const evalCase of savedTranscriptCases) {
    it(evalCase.id, (context) => {
      const result = savedTranscriptRun(evalCase)
      const { discovery, failureClass, loaded, reference, strict } =
        gradeDiscovery(result, evalCase.expectedSkillAreas, evalCase.condition)
      const scores = [
        score('AutonomousDiscoverySuccess', discovery.passed && loaded.passed, {
          rationale:
            'Scores only autonomous runs where Copilot used the condition-required discovery mechanism and loaded the expected skill.',
          failureClass,
        }),
        score('DiscoveryInvocation', discovery.passed, {
          mechanism: discovery.mechanism,
        }),
        score('StrictIntentInvocation', strict.passed, {
          matchedCommand: strict.matchedCommand,
          source: strict.source,
        }),
        score('CorrectSkillLoaded', loaded.passed, {
          loadedSkills: loaded.loadedSkills,
          expectedSkillAreas: evalCase.expectedSkillAreas,
        }),
        score('NoReferenceOnlyFalsePositive', !reference, {
          referenceOnly: reference,
        }),
      ]

      attachEvalMetadata({
        harnessName,
        run: result,
        scores,
        task: context.task,
      })

      expect(result.errors).toHaveLength(0)
      expect(failedSpans(result)).toHaveLength(0)
      expect(result.output.finalAnswer.length).toBeGreaterThan(0)
      expect(strict.passed).toBe(evalCase.strictInvocation)
      expect(loaded.passed).toBe(evalCase.correctSkillLoaded)
      expect(reference).toBe(evalCase.referenceOnly)
      expect(failureClass).toBe(evalCase.failureClass)
    })
  }
})

function savedTranscriptRun(
  evalCase: (typeof savedTranscriptCases)[number],
): HarnessRun<{ finalAnswer: string; runId: string }> {
  const runId = `saved:${evalCase.id}`
  return {
    output: { finalAnswer: evalCase.finalAnswer, runId },
    session: { messages: evalCase.messages },
    usage: { provider: 'saved-transcript', model: 'synthetic' },
    artifacts: {
      condition: evalCase.condition,
      expectedSkillAreas: evalCase.expectedSkillAreas,
      runKind: 'saved-transcript',
      taskId: evalCase.id,
    },
    errors: [],
    traces: [],
  }
}
