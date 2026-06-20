import { describe, expect, it } from 'vitest'
import { failedSpans, toolCalls } from 'vitest-evals'
import { countsTowardAutonomousScore } from './corpus/conditions'
import { correctSkillLoaded } from './graders/correct-skill-loaded'
import { attachEvalMetadata, score } from './graders/eval-metadata'
import { classifyFailure } from './graders/failure-classifier'
import { referenceOnly } from './graders/reference-only'
import { strictIntentInvocation } from './graders/strict-invocation'
import { savedTranscriptCases } from './fixtures/saved-transcripts'
import { savedTranscriptHarness } from './harness/saved-transcript-harness'
import type { HarnessContext } from 'vitest-evals'

describe('Intent discovery saved transcripts', () => {
  for (const evalCase of savedTranscriptCases) {
    it(evalCase.id, async (context) => {
      const result = await runSavedTranscript(evalCase)
      const strict = strictIntentInvocation(result)
      const loaded = correctSkillLoaded(result, evalCase.expectedSkillAreas)
      const reference = referenceOnly(result, evalCase.expectedSkillAreas)
      const failureClass = classifyFailure(result, evalCase.expectedSkillAreas)
      const autonomous = countsTowardAutonomousScore({
        condition: evalCase.condition,
        explicitnessLevel: evalCase.explicitnessLevel,
      })
      const scores = [
        score(
          'AutonomousDiscoverySuccess',
          autonomous && strict.passed && loaded.passed,
          {
            rationale:
              'Scores only autonomous runs where Copilot invoked Intent and loaded the expected skill.',
            failureClass,
          },
        ),
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
        harnessName: savedTranscriptHarness.name,
        run: result,
        scores,
        task: context.task,
      })

      expect(result.errors).toHaveLength(0)
      expect(failedSpans(result)).toHaveLength(0)
      expect(result.output.finalAnswer.length).toBeGreaterThan(0)
      expect(toolCalls(result).length).toBe(evalCase.toolCalls.length)
      expect(strict.passed).toBe(evalCase.expected.strictInvocation)
      expect(loaded.passed).toBe(evalCase.expected.correctSkillLoaded)
      expect(reference).toBe(evalCase.expected.referenceOnly)
      expect(failureClass).toBe(evalCase.expected.failureClass)
      expect(autonomous).toBe(evalCase.explicitnessLevel !== 4)
    })
  }
})

async function runSavedTranscript(
  evalCase: (typeof savedTranscriptCases)[number],
) {
  const artifacts: HarnessContext['artifacts'] = {}
  const context: HarnessContext = {
    artifacts,
    setArtifact(name, value) {
      artifacts[name] = value
    },
  }

  return savedTranscriptHarness.run(evalCase, context)
}
