import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSyncAliases,
  resolveSyncTargetDirectories,
} from '../../../packages/intent/src/commands/sync/targets.js'
import { buildCurrentLockfileSources } from '../../../packages/intent/src/core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../../../packages/intent/src/core/lockfile/lockfile.js'
import {
  SESSION_CATALOGUE_MAX_BYTES,
  SESSION_CATALOGUE_MAX_DESCRIPTION_LENGTH,
  SESSION_CATALOGUE_MAX_SKILLS,
  normalizeWhitespace,
  truncateText,
} from '../../../packages/intent/src/skills/catalogue-contract.js'
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
    filesWritten.push(...writeMappedGuidance(workspacePath, expectedSkillAreas))
  } else if (condition === 'mapped-exact-intent') {
    filesWritten.push(
      writeVisibleMappedGuidance(workspacePath, expectedSkillAreas),
    )
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

function writeMappedGuidance(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): Array<string> {
  const agentsPath = join(workspacePath, 'AGENTS.md')
  const skillsByPackage = new Map<
    string,
    Array<(typeof skillByArea)[ExpectedSkillArea]>
  >()

  for (const area of expectedSkillAreas) {
    const skill = skillByArea[area]
    const skills = skillsByPackage.get(skill.packageName) ?? []
    skills.push(skill)
    skillsByPackage.set(skill.packageName, skills)
  }

  const packages = [...skillsByPackage.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const mapPaths = packages.map(([packageName, skills]) => {
    const relativeMapPath = `.intent/maps/${packageName}.md`
    const mapPath = join(workspacePath, relativeMapPath)
    const entries = skills
      .map((skill) => ({
        description: skill.description,
        id: `${skill.packageName}#${skill.name}`,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    mkdirSync(dirname(mapPath), { recursive: true })
    writeFileSync(
      mapPath,
      `${[
        `# ${packageName}`,
        '',
        ...entries.map(({ description, id }) => `- \`${id}\`: ${description}`),
      ].join('\n')}\n`,
    )

    return { mapPath, packageName, relativeMapPath }
  })

  writeFileSync(
    agentsPath,
    `${[
      '<!-- intent-skills:start -->',
      '## Intent Skills',
      '',
      'At the start of every task, inspect the package list below.',
      'If the task names a listed package or changes code that imports, configures, or calls it, you MUST complete these steps before editing:',
      '1. Read that package\'s skill map.',
      '2. Match the task to the skill descriptions in the map.',
      '3. Copy each matching skill ID exactly. Never infer, shorten, or guess an ID.',
      '4. Run `npx @tanstack/intent load <id>` for each matching skill.',
      'Do not run an Intent load command until you have read the map. Do not edit until every matching skill is loaded.',
      'If no skill matches after reading the map, continue without loading a skill.',
      '',
      ...mapPaths.map(
        ({ packageName, relativeMapPath }) =>
          `- \`${packageName}\`: \`${relativeMapPath}\``,
      ),
      '<!-- intent-skills:end -->',
    ].join('\n')}\n`,
  )

  return [agentsPath, ...mapPaths.map(({ mapPath }) => mapPath)]
}

function writeVisibleMappedGuidance(
  workspacePath: string,
  expectedSkillAreas: Array<ExpectedSkillArea>,
): string {
  const agentsPath = join(workspacePath, 'AGENTS.md')
  const skills = expectedSkillAreas
    .map((area) => skillByArea[area])
  writeFileSync(agentsPath, buildVisibleMappedGuidance(skills))
  return agentsPath
}

export function buildVisibleMappedGuidance(
  input: ReadonlyArray<{
    description: string
    name: string
    packageName: string
  }>,
): string {
  const skills = input
    .map((skill) => ({
      ...skill,
      description: truncateText(
        normalizeWhitespace(skill.description),
        SESSION_CATALOGUE_MAX_DESCRIPTION_LENGTH,
      ),
    }))
    .sort((left, right) =>
      `${left.packageName}#${left.name}`.localeCompare(
        `${right.packageName}#${right.name}`,
      ),
    )
    .slice(0, SESSION_CATALOGUE_MAX_SKILLS)
  const selected = [...skills]
  let guidance = renderVisibleMappedGuidance(
    selected,
    input.length - selected.length,
  )
  while (
    Buffer.byteLength(guidance) > SESSION_CATALOGUE_MAX_BYTES &&
    selected.length > 0
  ) {
    selected.pop()
    guidance = renderVisibleMappedGuidance(
      selected,
      input.length - selected.length,
    )
  }
  if (Buffer.byteLength(guidance) > SESSION_CATALOGUE_MAX_BYTES) {
    throw new RangeError('Mapped Intent guidance exceeds the catalogue limit.')
  }
  return guidance
}

function renderVisibleMappedGuidance(
  skills: ReadonlyArray<{
    description: string
    name: string
    packageName: string
  }>,
  omittedSkillCount: number,
): string {
  const lines = [
    '<!-- intent-skills:start -->',
    '## Intent Skills',
    '',
    'Before implementation work on each new user request:',
    '1. Compare the request with every `for` description below.',
    '2. Run the exact `run` command for every clearly matching entry.',
    '3. Follow the returned guidance before editing.',
    '4. Load nothing when no entry matches.',
    '5. Repeat this check for later requests in the same conversation.',
    '',
  ]

  for (const skill of skills) {
    const use = `${skill.packageName}#${skill.name}`
    lines.push(`- id: ${JSON.stringify(use)}`)
    lines.push(`  for: ${JSON.stringify(skill.description)}`)
    lines.push(`  run: ${JSON.stringify(`npx @tanstack/intent load ${use}`)}`)
  }

  if (omittedSkillCount > 0) {
    lines.push(
      `- ${omittedSkillCount} additional ${omittedSkillCount === 1 ? 'skill' : 'skills'} omitted; run \`npx @tanstack/intent catalog <package>\` for the relevant package.`,
    )
  }

  lines.push('<!-- intent-skills:end -->')
  return `${lines.join('\n')}\n`
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
