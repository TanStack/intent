import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, relative } from 'node:path'
import { resolveProjectContext } from '../core/project-context.js'
import { resolveWorkspacePackages } from '../setup/workspace-patterns.js'
import { parseFrontmatter } from '../shared/utils.js'
import { stringList } from './add.js'
import {
  isObject,
  projectPath,
  readRecord,
  recordPath,
  skillEntries,
  skillPath,
} from './project.js'
import type { MaintainerProject } from './project.js'

export interface ExistingSkill {
  id: string
  name: string
  package: string
  path: string
  domain: string
  problems: Array<string>
}

const defaultDomain = 'uncategorized'

// Git-visible SKILL.md files under a skills/ directory of a workspace package
// that skill_tree.yaml does not register yet. Agent skill directories,
// dependencies, and packages outside the workspace are not library skills.
export function findExistingSkills(
  project: MaintainerProject,
): Array<ExistingSkill> {
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
  const tree = readRecord(project, 'skill_tree.yaml')
  const registered = new Set(
    skillEntries(project, tree).map((entry) =>
      relative(project.root, skillPath(project, entry)).replaceAll('\\', '/'),
    ),
  )
  const mapPath = recordPath(project, 'domain_map.yaml')
  const mapped: Array<unknown> = existsSync(mapPath)
    ? readRecord(project, 'domain_map.yaml').document.toJS().skills
    : []
  const packageRoots = new Set([
    project.root,
    ...resolveWorkspacePackages(
      project.root,
      resolveProjectContext({ cwd: project.root }).workspacePatterns,
    ),
  ])
  const skills = files
    .filter(
      (path) =>
        basename(path) === 'SKILL.md' &&
        /(^|\/)skills\//.test(path) &&
        !path
          .split('/')
          .some((part) => part.startsWith('.') || part === 'node_modules') &&
        !registered.has(path),
    )
    .sort()
    .flatMap<ExistingSkill>((id) => {
      const skill: ExistingSkill = {
        id,
        name: basename(dirname(id)),
        package: '',
        path: id,
        domain: '',
        problems: [],
      }
      try {
        const absolute = projectPath(project.root, id)
        const context = resolveProjectContext({
          cwd: project.root,
          targetPath: absolute,
        })
        if (!context.packageRoot || !packageRoots.has(context.packageRoot))
          return []
        skill.package = relative(project.root, context.packageRoot).replaceAll(
          '\\',
          '/',
        )
        skill.path = relative(context.packageRoot, absolute).replaceAll(
          '\\',
          '/',
        )
        const frontmatter = parseFrontmatter(absolute)
        if (
          !frontmatter ||
          typeof frontmatter.name !== 'string' ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name) ||
          frontmatter.name.length > 64 ||
          frontmatter.name !== skill.name
        )
          throw new Error('Skill name must match its directory.')
        if (
          typeof frontmatter.description !== 'string' ||
          !frontmatter.description.trim()
        )
          throw new Error('Skill needs a non-empty description.')
        stringList(frontmatter.sources ?? [], 'sources')
        stringList(frontmatter.requires ?? [], 'requires')
        skill.domain = inferDomain(frontmatter, mapped, id)
      } catch (error) {
        skill.problems.push(
          error instanceof Error ? error.message : String(error),
        )
      }
      return [skill]
    })
  for (const skill of skills) {
    if (
      skills.some((other) => other.id !== skill.id && other.name === skill.name)
    )
      skill.problems.push(
        'Another skill has the same name. Rename one before it can be registered.',
      )
  }
  return skills
}

// metadata.domain, then the domain map, then a parent directory between
// skills/ and the skill directory, then a placeholder the maintainer can edit.
function inferDomain(
  frontmatter: Record<string, unknown>,
  mapped: Array<unknown>,
  id: string,
): string {
  const metadata = frontmatter.metadata
  if (isObject(metadata) && typeof metadata.domain === 'string')
    return metadata.domain
  const name = basename(dirname(id))
  const mapping = mapped.find((value) => isObject(value) && value.slug === name)
  if (isObject(mapping) && typeof mapping.domain === 'string')
    return mapping.domain
  const parent = basename(dirname(dirname(id)))
  return parent === 'skills' ? defaultDomain : parent
}
