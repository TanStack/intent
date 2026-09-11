import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { resolveProjectContext } from '../core/project-context.js'
import { parseFrontmatter } from '../shared/utils.js'
import {
  authoringMarker,
  isObject,
  projectPath,
  readRecord,
  recordPath,
  skillEntries,
  skillPath,
} from './project.js'
import { writeChanges } from './files.js'
import type { MaintainerProject, SkillEntry } from './project.js'
import type { FileChange } from './files.js'

export interface AddSkillOptions {
  package?: string
  path?: string
  domain?: string
  description?: string
  source?: string | Array<string>
  requires?: string | Array<string>
}

export function stringList(value: unknown, label: string): Array<string> {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item.trim())
  )
    throw new Error(`${label} must be an array of non-empty strings.`)
  return [...new Set(value)]
}

export function addSkill(
  project: MaintainerProject,
  name: string | undefined,
  options: AddSkillOptions,
): string {
  const plan = planAddSkills(project, [{ name, options }])
  writeChanges(project.root, plan.changes)
  return plan.paths[0]!
}

export function planAddSkills(
  project: MaintainerProject,
  additions: Array<{ name: string | undefined; options: AddSkillOptions }>,
  initialChanges: Array<FileChange> = [],
) {
  const changes = [...initialChanges]
  const entries = skillEntries(project, changes)
  const tree = readRecord(project, 'skill_tree.yaml', changes)
  const map = readRecord(project, 'domain_map.yaml', changes)
  const specPath = recordPath(project, 'skill_spec.md')
  const specChange = changes.find((change) => change.path === specPath)
  const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : null
  let nextSpec = specChange?.content ?? spec
  if (nextSpec === null)
    throw new Error('Missing skill_spec.md. Run intent maintainer setup.')
  const paths: Array<string> = []
  for (const { name, options } of additions) {
    if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      throw new Error(
        'Choose a skill name of at most 64 lowercase letters, numbers, and hyphens.',
      )
    if (!options.domain?.trim())
      throw new Error('Choose the task domain with --domain <slug>.')
    if (entries.some((entry) => (entry.slug ?? entry.name) === name))
      throw new Error(
        `Skill ${name} is already registered. Edit its SKILL.md, then run intent maintainer sync.`,
      )
    const packageDir = options.package === '.' ? undefined : options.package
    const entry: SkillEntry = {
      name,
      slug: name,
      domain: options.domain,
      ...(packageDir ? { package: packageDir } : {}),
      path: options.path ?? `skills/${name}/SKILL.md`,
    }
    const path = skillPath(project, entry)
    if (basename(dirname(path)) !== name)
      throw new Error('The skill name must match its parent directory.')
    if (entries.some((existing) => skillPath(project, existing) === path))
      throw new Error(`Skill path is already registered: ${entry.path}`)
    const packageRoot = packageDir
      ? projectPath(project.root, packageDir)
      : project.root
    const manifestPath = projectPath(
      project.root,
      packageDir ? `${packageDir}/package.json` : 'package.json',
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (
      resolveProjectContext({ cwd: project.root, targetPath: path })
        .packageRoot !== packageRoot
    )
      throw new Error('The skill path must belong to the selected package.')
    let frontmatter: Record<string, unknown>
    if (existsSync(path)) {
      if (options.description || options.source || options.requires)
        throw new Error(
          'To register an existing skill, supply its --path and --domain; edit its frontmatter directly before running sync.',
        )
      const parsed = parseFrontmatter(path)
      if (!isObject(parsed) || parsed.name !== name)
        throw new Error(
          'Existing skill has invalid frontmatter or a different name.',
        )
      frontmatter = parsed
    } else {
      if (!options.description?.trim())
        throw new Error('A new skill needs --description <activation text>.')
      const sources = stringList(
        options.source === undefined ? [] : [options.source].flat(),
        'sources',
      )
      if (!sources.length)
        throw new Error('A new skill needs at least one --source <path>.')
      frontmatter = {
        name,
        description: options.description,
        metadata: { library: manifest.name },
        sources,
        ...(options.requires
          ? { requires: stringList([options.requires].flat(), 'requires') }
          : {}),
      }
      changes.push({
        path,
        source: null,
        content: `---\n${stringify(frontmatter)}---\n\n${authoringMarker}\n\nWrite the task procedure, working examples, source-backed pitfalls, and completion checks. Add metadata.purpose in your own words. Remove the authoring marker after writing and checking the guidance.\n`,
      })
    }
    if (
      typeof frontmatter.description !== 'string' ||
      !frontmatter.description.trim()
    )
      throw new Error('A skill needs a non-empty description.')
    entry.description = frontmatter.description
    entry.sources = stringList(frontmatter.sources ?? [], 'sources')
    entry.requires = stringList(frontmatter.requires ?? [], 'requires')
    if (
      isObject(frontmatter.metadata) &&
      typeof frontmatter.metadata.purpose === 'string'
    )
      entry.purpose = frontmatter.metadata.purpose
    tree.document.addIn(['skills'], entry)
    entries.push(entry)
    const mapSkills: Array<Record<string, unknown>> = map.document.toJS().skills
    if (!mapSkills.some((skill) => skill.slug === name)) {
      map.document.addIn(['skills'], {
        name,
        slug: name,
        domain: options.domain,
        description: entry.purpose ?? entry.description,
        ...(packageDir ? { packages: [manifest.name] } : {}),
        tasks: [],
        covers: [],
      })
    }
    nextSpec = `${nextSpec.trimEnd()}\n\n- Registered \`${name}\` in \`${packageDir ?? '.'}\` (domain \`${options.domain}\`). Task coverage, decisions, and checks still need to be recorded.\n`
    paths.push(join(packageDir ?? '', entry.path))
  }
  if (additions.length) {
    changes.push(
      {
        path: tree.path,
        source: tree.source,
        content: tree.document.toString(),
      },
      { path: map.path, source: map.source, content: map.document.toString() },
      { path: specPath, source: spec, content: nextSpec },
    )
  }
  return {
    changes: [
      ...new Map(changes.map((change) => [change.path, change])).values(),
    ],
    paths,
  }
}
