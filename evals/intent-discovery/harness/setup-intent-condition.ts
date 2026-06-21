import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildIntentSkillGuidanceBlock,
  buildIntentSkillsBlock,
} from '../../../packages/intent/src/commands/install/guidance.js'
import {
  expectedSkillUseByArea,
  packageAllowlistByArea,
} from '../corpus/skill-uses'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'
import type { ScanResult } from '../../../packages/intent/src/shared/types.js'

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
    ...writeSkillPackages(workspacePath, expectedSkillAreas),
  ]

  return { condition, filesWritten }
}

function writeSkillPackages(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): Array<string> {
  return expectedSkillAreas.flatMap((area) => {
    const packageName = packageAllowlistByArea[area]
    const use = expectedSkillUseByArea[area]
    const skillName = use.split('#')[1]

    if (!skillName) {
      throw new Error(`Invalid expected skill use for ${area}: ${use}`)
    }

    const packageRoot = join(
      workspacePath,
      'node_modules',
      ...packageName.split('/'),
    )
    const skillDir = join(packageRoot, 'skills', skillName)
    const packageJsonPath = join(packageRoot, 'package.json')
    const skillPath = join(skillDir, 'SKILL.md')

    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(
        {
          name: packageName,
          version: '0.0.0-intent-eval',
          intent: {
            version: 1,
            repo: `TanStack/${area}`,
            docs: 'docs/',
          },
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      skillPath,
      `---\nname: "${skillName}"\ndescription: "Guidance for ${area} eval tasks"\n---\n\nUse this skill for ${area} eval tasks.\n`,
    )

    return [packageJsonPath, skillPath]
  })
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
    condition === 'mapped-intent' || condition === 'hooked-intent'
      ? mappedGuidanceBlock(expectedSkillAreas)
      : loadingGuidanceBlock()

  writeFileSync(agentsPath, `${block}\n`)

  return agentsPath
}

function loadingGuidanceBlock(): string {
  return buildIntentSkillGuidanceBlock('npm').block.trimEnd()
}

function mappedGuidanceBlock(
  expectedSkillAreas: Array<ExpectedSkillArea>,
): string {
  return buildIntentSkillsBlock(
    scanResultForAreas(expectedSkillAreas),
  ).block.trimEnd()
}

function scanResultForAreas(
  expectedSkillAreas: Array<ExpectedSkillArea>,
): ScanResult {
  return {
    conflicts: [],
    nodeModules: {
      global: { detected: false, exists: false, path: null, scanned: false },
      local: {
        detected: true,
        exists: true,
        path: 'node_modules',
        scanned: true,
      },
    },
    notices: [],
    packageManager: 'npm',
    packages: expectedSkillAreas.map((area) => {
      const packageName = packageAllowlistByArea[area]
      const use = expectedSkillUseByArea[area]
      const skillName = use.split('#')[1]

      if (!skillName) {
        throw new Error(`Invalid expected skill use for ${area}: ${use}`)
      }

      return {
        intent: {
          docs: 'docs/',
          repo: `TanStack/${area}`,
          version: 1,
        },
        kind: 'npm',
        name: packageName,
        packageRoot: `node_modules/${packageName}`,
        skills: [
          {
            description: `Guidance for ${area} eval tasks`,
            name: skillName,
            path: `node_modules/${packageName}/skills/${skillName}/SKILL.md`,
          },
        ],
        source: 'local',
        version: '0.0.0-intent-eval',
      }
    }),
    stats: { packageJsonCacheHits: 0, packageJsonReadCount: 0 },
    warnings: [],
  }
}
