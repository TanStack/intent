import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIntentSkillGuidanceBlock } from '../../../packages/intent/src/commands/install/guidance.js'
import {
  createSyncAliases,
  resolveSyncTargetDirectories,
} from '../../../packages/intent/src/commands/sync/targets.js'
import { buildCurrentLockfileSources } from '../../../packages/intent/src/core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../../../packages/intent/src/core/lockfile/lockfile.js'
import { skillByArea } from '../corpus/skill-uses'
import type { IntentDiscoveryCondition } from '../corpus/conditions'
import type { ExpectedSkillArea } from '../corpus/tasks'
import type { ScanResult } from '../../../packages/intent/src/shared/types.js'

const intentPackageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/intent',
)

export function applyIntentCondition({
  condition,
  expectedSkillAreas,
  workspacePath,
}: {
  condition: IntentDiscoveryCondition
  expectedSkillAreas: Array<ExpectedSkillArea>
  workspacePath: string
}): Array<string> {
  if (condition === 'no-intent' || condition === 'plain-docs') {
    return []
  }

  const filesWritten = [
    writePackageAllowlist(workspacePath, expectedSkillAreas),
    ...writeSkillPackages(workspacePath, expectedSkillAreas),
    ...writeIntentPackageLinks(workspacePath),
    writeLockfile(workspacePath, expectedSkillAreas),
  ]

  if (condition === 'symlink-intent') {
    filesWritten.push(...writeSkillLinks(workspacePath, expectedSkillAreas))
  } else if (condition === 'mapped-intent') {
    filesWritten.push(writeAgentsFile(workspacePath))
  }

  return filesWritten
}

function writeIntentPackageLinks(workspacePath: string): Array<string> {
  const linkPath = join(workspacePath, 'node_modules', '@tanstack', 'intent')

  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(relative(dirname(linkPath), intentPackageRoot), linkPath, 'dir')

  const binPath = join(workspacePath, 'node_modules', '.bin', 'intent')
  mkdirSync(dirname(binPath), { recursive: true })
  symlinkSync(
    relative(dirname(binPath), join(intentPackageRoot, 'dist', 'cli.mjs')),
    binPath,
    'file',
  )

  return [linkPath, binPath]
}

function writeLockfile(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): string {
  const lockfilePath = join(workspacePath, 'intent.lock')

  writeIntentLockfile(lockfilePath, {
    lockfileVersion: 1,
    sources: buildCurrentLockfileSources(
      skillPackages(expectedSkillAreas, workspacePath),
    ),
  })

  return lockfilePath
}

function writeSkillLinks(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): Array<string> {
  const targetDirectory = resolveSyncTargetDirectories(workspacePath, [
    'github',
  ])[0]!.path
  const aliases = createSyncAliases(
    expectedSkillAreas.map((area) => ({
      kind: 'npm',
      id: skillByArea[area].packageName,
      skill: skillByArea[area].name,
    })),
  )

  mkdirSync(targetDirectory, { recursive: true })

  return aliases.map(({ alias, id, skill }) => {
    const sourceDirectory = join(
      workspacePath,
      'node_modules',
      ...id.split('/'),
      'skills',
      skill,
    )
    const linkPath = join(targetDirectory, alias)

    symlinkSync(relative(dirname(linkPath), sourceDirectory), linkPath, 'dir')

    return linkPath
  })
}

function writeSkillPackages(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): Array<string> {
  return expectedSkillAreas.flatMap((area) => {
    const skill = skillByArea[area]
    const packageName = skill.packageName
    const skillName = skill.name

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
      `---\nname: "${skillName}"\ndescription: "${skill.description}"\n---\n\n${skill.guidance}\n`,
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
    devDependencies?: Record<string, string>
    intent?: { exclude?: Array<string>; skills?: Array<string> }
  }

  packageJson.devDependencies = {
    ...packageJson.devDependencies,
    '@tanstack/intent': '0.0.0-intent-eval',
  }
  packageJson.intent = {
    ...packageJson.intent,
    exclude: [],
    skills: expectedSkillAreas.map((area) => skillByArea[area].packageName),
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  return packageJsonPath
}

function writeAgentsFile(workspacePath: string): string {
  const agentsPath = join(workspacePath, 'AGENTS.md')

  writeFileSync(agentsPath, buildIntentSkillGuidanceBlock('npm', true).block)

  return agentsPath
}

function skillPackages(
  expectedSkillAreas: Array<ExpectedSkillArea>,
  workspacePath: string,
): ScanResult['packages'] {
  return expectedSkillAreas.map((area) => {
    const skill = skillByArea[area]
    const packageName = skill.packageName
    const skillName = skill.name
    const packageRoot = join(
      workspacePath,
      'node_modules',
      ...packageName.split('/'),
    )

    return {
      intent: { docs: 'docs/', repo: `TanStack/${area}`, version: 1 },
      kind: 'npm',
      name: packageName,
      packageRoot,
      skills: [
        {
          description: skill.description,
          name: skillName,
          path: join(packageRoot, 'skills', skillName, 'SKILL.md'),
        },
      ],
      source: 'local',
      version: '0.0.0-intent-eval',
    }
  })
}
