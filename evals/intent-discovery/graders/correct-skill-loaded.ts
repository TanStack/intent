import type { HarnessRun } from 'vitest-evals'
import { toolCalls } from 'vitest-evals'
import type { ExpectedSkillArea } from '../corpus/tasks'
import { listIncludesExpectedSkillArea } from './skill-areas'

export type CorrectSkillLoadedResult = {
  passed: boolean
  loadedSkills: string[]
}

export function correctSkillLoaded(
  run: HarnessRun,
  expectedSkillAreas: ExpectedSkillArea[],
): CorrectSkillLoadedResult {
  const loadedSkills = loadedSkillsFromRun(run)

  return {
    passed: listIncludesExpectedSkillArea(loadedSkills, expectedSkillAreas),
    loadedSkills,
  }
}

function loadedSkillsFromRun(run: HarnessRun): string[] {
  const artifactSkills = stringArrayArtifact(run.artifacts?.loadedSkills)
  const commandSkills = toolCalls(run)
    .map((call) => commandString(call.arguments?.command))
    .filter((command): command is string => Boolean(command))
    .map((command) => skillFromLoadCommand(command))
    .filter((skill): skill is string => Boolean(skill))

  return [...new Set([...artifactSkills, ...commandSkills])]
}

function stringArrayArtifact(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (candidate): candidate is string => typeof candidate === 'string',
  )
}

function commandString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function skillFromLoadCommand(command: string): string | undefined {
  const match = command.match(
    /(?:^|\s)(?:(?:pnpm\s+exec\s+intent)|(?:npx\s+@tanstack\/intent)|(?:intent))\s+load\s+(\S+)/i,
  )

  return match?.[1]
}
