import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, relative } from 'node:path'
import { resolveProjectContext } from '../core/project-context.js'
import { resolveWorkspacePackages } from '../setup/workspace-patterns.js'
import { parseFrontmatter } from '../shared/utils.js'
import { planAddSkills, stringList } from './add.js'
import {
  inferDistributionRepository,
  planDistributionChoice,
  readDistribution,
} from './distribution.js'
import {
  isObject,
  planSetupRecords,
  projectPath,
  readRecord,
  recordPath,
  skillEntries,
  skillPath,
} from './project.js'
import type { MaintainerProject } from './project.js'

export interface AdoptionSkill {
  id: string
  name: string
  package: string
  path: string
  description: string
  domain: string
  status:
    | 'unregistered'
    | 'registered'
    | 'missing'
    | 'invalid'
    | 'conflict'
    | 'planned'
    | 'retired'
  problems: Array<string>
  selected: boolean
}

export function createAdoptionPlan(
  project: MaintainerProject,
  directory?: string,
) {
  if (directory) projectPath(project.root, directory)
  const files = execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    { cwd: project.root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean)
  const records = ['domain_map.yaml', 'skill_spec.md', 'skill_tree.yaml'].map(
    (name) => {
      const path = recordPath(project, name)
      return [path, existsSync(path) ? readFileSync(path, 'utf8') : null]
    },
  )
  const hasTree = existsSync(recordPath(project, 'skill_tree.yaml'))
  const entries = hasTree ? skillEntries(project) : []
  const registered = new Map(
    entries.map((entry) => [
      relative(project.root, skillPath(project, entry)).replaceAll('\\', '/'),
      entry,
    ]),
  )
  const mapPath = recordPath(project, 'domain_map.yaml')
  const mapped = existsSync(mapPath)
    ? readRecord(project, 'domain_map.yaml').document.toJS().skills
    : []
  const paths = [
    ...new Set([
      ...files.filter(
        (path) =>
          basename(path) === 'SKILL.md' &&
          !path
            .split('/')
            .some((part) => part.startsWith('.') || part === 'node_modules') &&
          (/(^|\/)skills\//.test(path) ||
            (directory && path.startsWith(`${directory}/`))),
      ),
      ...registered.keys(),
    ]),
  ].sort()
  const snapshot: Array<unknown> = [
    records,
    ...[
      'package.json',
      'pnpm-workspace.yaml',
      'AGENTS.md',
      'CLAUDE.md',
      '.cursorrules',
      '.github/copilot-instructions.md',
      '.claude-plugin/plugin.json',
      '.cursor-plugin/plugin.json',
    ].map((name) => {
      const path = projectPath(project.root, name)
      return [name, existsSync(path) ? readFileSync(path, 'utf8') : null]
    }),
  ]
  const packageRoots = new Set([
    project.root,
    ...resolveWorkspacePackages(
      project.root,
      resolveProjectContext({ cwd: project.root }).workspacePatterns,
    ),
  ])
  const skills = paths.flatMap<AdoptionSkill>((id) => {
    const entry = registered.get(id)
    const candidate: AdoptionSkill = {
      id,
      name: String(entry?.slug ?? entry?.name ?? basename(dirname(id))),
      package: entry?.package ?? '',
      path: entry?.path ?? id,
      description: '',
      domain: typeof entry?.domain === 'string' ? entry.domain : '',
      status: entry ? 'registered' : 'unregistered',
      problems: [],
      selected: false,
    }
    if (entry?.status === 'planned' || entry?.status === 'retired') {
      candidate.status = entry.status
      return [candidate]
    }
    try {
      const absolute = projectPath(project.root, id)
      if (!existsSync(absolute)) {
        candidate.status = 'missing'
        candidate.problems.push('Registered skill file is missing.')
        snapshot.push([id, null])
        return [candidate]
      }
      const context = resolveProjectContext({
        cwd: project.root,
        targetPath: absolute,
      })
      if (!context.packageRoot)
        throw new Error('Skill has no owning package.json.')
      if (
        !entry &&
        !packageRoots.has(context.packageRoot) &&
        !(directory && id.startsWith(`${directory}/`))
      )
        return []
      candidate.package = relative(
        project.root,
        context.packageRoot,
      ).replaceAll('\\', '/')
      candidate.path = relative(context.packageRoot, absolute).replaceAll(
        '\\',
        '/',
      )
      const manifest = projectPath(
        project.root,
        candidate.package
          ? `${candidate.package}/package.json`
          : 'package.json',
      )
      snapshot.push([
        id,
        readFileSync(absolute, 'utf8'),
        readFileSync(manifest, 'utf8'),
      ])
      const frontmatter = parseFrontmatter(absolute)
      if (
        !frontmatter ||
        typeof frontmatter.name !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name) ||
        frontmatter.name.length > 64 ||
        frontmatter.name !== basename(dirname(id)) ||
        (entry && frontmatter.name !== candidate.name)
      )
        throw new Error(
          'Skill name must match its directory and registered identity.',
        )
      candidate.name = frontmatter.name
      if (
        typeof frontmatter.description !== 'string' ||
        !frontmatter.description.trim()
      )
        throw new Error('Skill needs a non-empty description.')
      candidate.description = frontmatter.description
      stringList(frontmatter.sources ?? [], 'sources')
      stringList(frontmatter.requires ?? [], 'requires')
      const mapping = mapped.find(
        (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          'slug' in value &&
          value.slug === candidate.name,
      )
      if (!candidate.domain && typeof mapping?.domain === 'string')
        candidate.domain = mapping.domain
      if (entry && (entry.package ?? '') !== candidate.package)
        throw new Error('Skill ownership differs from its registration.')
    } catch (error) {
      candidate.status = 'invalid'
      candidate.problems.push(
        error instanceof Error ? error.message : String(error),
      )
    }
    return [candidate]
  })
  for (const candidate of skills) {
    if (
      skills.some(
        (other) => other.id !== candidate.id && other.name === candidate.name,
      )
    ) {
      candidate.status = 'conflict'
      candidate.problems.push(
        'Another skill has the same name. Resolve the identity before adoption.',
      )
    }
  }
  return {
    schemaVersion: 1 as const,
    root: project.root,
    artifacts: project.artifacts,
    directory,
    fingerprint: createHash('sha256')
      .update(JSON.stringify([project, directory, snapshot, skills]))
      .digest('hex'),
    distribution: (hasTree ? readDistribution(project) : undefined) ?? {
      mode: 'unconfigured' as const,
      repository: inferDistributionRepository(project),
    },
    skills,
  }
}

export type AdoptionPlan = ReturnType<typeof createAdoptionPlan>

export interface AdoptionPrompts {
  choose: (plan: AdoptionPlan) => Promise<AdoptionPlan | null>
  confirm: (plan: AdoptionPlan, files: Array<string>) => Promise<boolean>
}

export function planAdoptionChanges(
  project: MaintainerProject,
  input: unknown,
) {
  if (
    !isObject(input) ||
    input.schemaVersion !== 1 ||
    input.root !== project.root ||
    input.artifacts !== project.artifacts ||
    !Array.isArray(input.skills) ||
    (input.directory !== undefined && typeof input.directory !== 'string')
  )
    throw new Error(
      'Use an adoption plan from maintainer adopt --json in this repository.',
    )
  const current = createAdoptionPlan(project, input.directory)
  if (input.fingerprint !== current.fingerprint)
    throw new Error(
      'Skills or planning records changed. Create a new adoption plan before applying.',
    )
  if (input.skills.length !== current.skills.length)
    throw new Error(
      'Keep every adoption plan entry; change selected and domain only.',
    )
  const seen = new Set<string>()
  const additions = input.skills.flatMap((value: unknown) => {
    if (
      !isObject(value) ||
      typeof value.id !== 'string' ||
      typeof value.selected !== 'boolean' ||
      typeof value.domain !== 'string' ||
      seen.has(value.id)
    )
      throw new Error(
        'Each adoption choice needs a unique id, selected boolean, and domain string.',
      )
    seen.add(value.id)
    const candidate = current.skills.find((skill) => skill.id === value.id)
    if (
      !candidate ||
      ['name', 'package', 'path', 'status'].some(
        (key) => value[key] !== candidate[key as keyof AdoptionSkill],
      )
    )
      throw new Error('Adoption identities changed. Create a new plan.')
    if (!value.selected) return []
    if (candidate.status !== 'unregistered')
      throw new Error(`Cannot adopt ${candidate.id}: ${candidate.status}.`)
    if (!value.domain.trim())
      throw new Error(`Choose a domain for ${candidate.name}.`)
    return [
      {
        name: candidate.name,
        options: {
          package: candidate.package || undefined,
          path: candidate.path,
          domain: value.domain.trim(),
        },
      },
    ]
  })
  const plan = planAddSkills(project, additions, planSetupRecords(project))
  const choice = input.distribution
  if (
    !isObject(choice) ||
    !['repo', 'none', 'unconfigured'].includes(String(choice.mode))
  )
    throw new Error(
      'Choose repository distribution, none, or leave the current choice unchanged.',
    )
  if (
    choice.mode === 'unconfigured' &&
    current.distribution.mode !== 'unconfigured'
  )
    throw new Error(
      'Preserve the distribution choice or select an explicit opt-out.',
    )
  const distribution = planDistributionChoice(
    project,
    choice.mode === 'unconfigured'
      ? {}
      : {
          distribution: String(choice.mode),
          ...(choice.mode === 'repo'
            ? {
                repository:
                  typeof choice.repository === 'string'
                    ? choice.repository
                    : undefined,
                pluginName:
                  typeof choice.name === 'string' ? choice.name : undefined,
                skill: stringList(choice.skills, 'distribution.skills'),
              }
            : {}),
        },
    plan.changes,
  )
  if (distribution) {
    const index = plan.changes.findIndex(
      (change) => change.path === distribution.path,
    )
    if (index < 0) plan.changes.push(distribution)
    else plan.changes[index] = distribution
  }
  return plan
}
