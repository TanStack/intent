import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { resolveProjectContext } from '../core/project-context.js'

export const authoringMarker = '<!-- intent:needs-authoring -->'
const recordNames = ['domain_map.yaml', 'skill_spec.md', 'skill_tree.yaml']

export interface MaintainerProject {
  root: string
  artifacts: string
}

export function projectPath(root: string, path: string): string {
  if (!path || path.includes('\\') || path.includes('\0') || path.includes(':'))
    throw new Error(
      `Expected a repository-relative path: ${JSON.stringify(path)}`,
    )
  let current = root
  for (const part of path.split('/')) {
    if (!part || ['.', '..', '.git', 'node_modules'].includes(part))
      throw new Error(`Unsafe maintainer path: ${JSON.stringify(path)}`)
    current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Maintainer paths cannot use symbolic links: ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return current
}

export function resolveMaintainerProject(
  cwd: string,
  artifacts?: string,
): MaintainerProject {
  let root: string
  try {
    root = execFileSync(
      'git',
      ['-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  } catch {
    throw new Error('Maintainer commands require a Git working tree.')
  }
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
      '--',
      ...recordNames.map((name) => `:(glob)**/${name}`),
      ':(exclude,glob)**/node_modules/**',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const locations = [...new Set(files.split('\0').filter(Boolean).map(dirname))]
  if (!artifacts && locations.length > 1)
    throw new Error(
      `Multiple planning locations found: ${locations.join(', ')}. Select the established record with --artifacts <directory>.`,
    )
  artifacts ??=
    locations[0] ??
    (resolveProjectContext({ cwd: root }).isMonorepo
      ? '_artifacts'
      : 'skills/_artifacts')
  if (artifacts !== '.') projectPath(root, artifacts)
  return { root, artifacts }
}

export function recordPath(project: MaintainerProject, name: string): string {
  return projectPath(
    project.root,
    join(project.artifacts, name).replaceAll('\\', '/'),
  )
}

export function readRecord(project: MaintainerProject, name: string) {
  const path = recordPath(project, name)
  if (!existsSync(path))
    throw new Error(`Missing ${name}. Run intent maintainer setup.`)
  const source = readFileSync(path, 'utf8')
  const document = parseDocument(source)
  const parsed: unknown = document.toJS()
  if (
    document.errors.length ||
    !isObject(parsed) ||
    !Array.isArray(parsed.skills)
  )
    throw new Error(
      `Invalid ${name}: expected a YAML object with a skills array.`,
    )
  return { path, source, document }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface SkillEntry extends Record<string, unknown> {
  name: string
  path: string
  package?: string
}

export function skillEntries(project: MaintainerProject): Array<SkillEntry> {
  const entries: Array<unknown> = readRecord(
    project,
    'skill_tree.yaml',
  ).document.toJS().skills
  const names = new Set<string>()
  const paths = new Set<string>()
  return entries.map((entry) => {
    if (
      !isObject(entry) ||
      typeof entry.name !== 'string' ||
      !entry.name ||
      typeof entry.path !== 'string' ||
      (entry.package !== undefined && typeof entry.package !== 'string')
    )
      throw new Error(
        'Each skill tree entry requires name, path, and an optional package directory.',
      )
    const skill = entry as SkillEntry
    const path = skillPath(project, skill)
    const identity = typeof skill.slug === 'string' ? skill.slug : skill.name
    if (names.has(identity) || paths.has(path))
      throw new Error(`Duplicate skill identity or path: ${identity}`)
    names.add(identity)
    paths.add(path)
    return skill
  })
}

export function skillPath(
  project: MaintainerProject,
  entry: SkillEntry,
): string {
  const path = projectPath(
    project.root,
    entry.package ? `${entry.package}/${entry.path}` : entry.path,
  )
  if (basename(path) !== 'SKILL.md')
    throw new Error(`Skill path must end in SKILL.md: ${entry.path}`)
  return path
}

export function setupRecords(project: MaintainerProject): Array<string> {
  const { root } = project
  const context = resolveProjectContext({ cwd: root })
  if (!context.packageRoot)
    throw new Error(
      'Maintainer setup requires package.json at the library root.',
    )
  const manifest = JSON.parse(
    readFileSync(join(context.packageRoot, 'package.json'), 'utf8'),
  )
  const library = {
    name: manifest.name ?? basename(root),
    ...(manifest.version ? { version: manifest.version } : {}),
  }
  const defaults: Record<string, string> = {
    'domain_map.yaml': stringify({
      library,
      domains: [],
      skills: [],
      gaps: [],
    }),
    'skill_tree.yaml': stringify({
      library,
      generated_from: {
        domain_map: relative(
          root,
          recordPath(project, 'domain_map.yaml'),
        ).replaceAll('\\', '/'),
        skill_spec: relative(
          root,
          recordPath(project, 'skill_spec.md'),
        ).replaceAll('\\', '/'),
      },
      skills: [],
    }),
    'skill_spec.md': `# ${library.name} skill spec\n\n${authoringMarker}\n\nDescribe the assessed tasks, confirmed decisions, source evidence, and remaining work. Preserve this history as the library changes. Remove the authoring marker after writing this record.\n\n## Coverage and batch history\n`,
  }
  // Validate surviving records before creating missing companions.
  for (const name of recordNames) {
    if (name.endsWith('.yaml') && existsSync(recordPath(project, name)))
      readRecord(project, name)
  }
  const created: Array<string> = []
  for (const [name, content] of Object.entries(defaults)) {
    const path = recordPath(project, name)
    if (existsSync(path)) continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { flag: 'wx' })
    created.push(relative(root, path))
  }
  return created
}
