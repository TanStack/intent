import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'
import {
  expectedSkillUseByArea,
  packageAllowlistByArea,
} from '../corpus/skill-uses'

export type AppliedIntentCondition = {
  condition: IntentDiscoveryCondition
  filesWritten: Array<string>
}

export function applyIntentCondition({
  condition,
  expectedSkillAreas,
  workspacePath,
}: {
  condition: IntentDiscoveryCondition
  expectedSkillAreas: Array<ExpectedSkillArea>
  workspacePath: string
}): AppliedIntentCondition {
  if (condition === 'no-intent' || condition === 'plain-docs') {
    return { condition, filesWritten: [] }
  }

  const filesWritten = [
    writePackageAllowlist(workspacePath, expectedSkillAreas),
    writeAgentsFile({ condition, expectedSkillAreas, workspacePath }),
  ]

  return { condition, filesWritten }
}

function writePackageAllowlist(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): string {
  const packageJsonPath = join(workspacePath, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    intent?: { skills?: Array<string> }
  }

  packageJson.intent = {
    ...packageJson.intent,
    skills: expectedSkillAreas.map((area) => packageAllowlistByArea[area]),
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  return packageJsonPath
}

function writeAgentsFile({
  condition,
  expectedSkillAreas,
  workspacePath,
}: {
  condition: IntentDiscoveryCondition
  expectedSkillAreas: Array<ExpectedSkillArea>
  workspacePath: string
}): string {
  const agentsPath = join(workspacePath, 'AGENTS.md')
  const block =
    condition === 'mapped-intent'
      ? mappedGuidanceBlock(expectedSkillAreas)
      : loadingGuidanceBlock()

  writeFileSync(agentsPath, `${block}\n`)

  return agentsPath
}

function loadingGuidanceBlock(): string {
  return `<!-- intent-skills:start -->
## Skill Loading

Before substantial work:

- Skill check: run \`npx @tanstack/intent@latest list\`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run \`npx @tanstack/intent@latest load <package>#<skill>\` and follow the returned \`SKILL.md\`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->`
}

function mappedGuidanceBlock(
  expectedSkillAreas: Array<ExpectedSkillArea>,
): string {
  const mappings = expectedSkillAreas
    .map((area) => {
      const use = expectedSkillUseByArea[area]

      return `  - when: "working on ${area} tasks"
    use: "${use}"`
    })
    .join('\n')

  return `<!-- intent-skills:start -->
# Skill mappings - load \`use\` with \`npx @tanstack/intent@latest load <use>\`.
skills:
${mappings}
<!-- intent-skills:end -->`
}
