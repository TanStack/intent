import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { stringify } from 'yaml'
import { resolveProjectContext } from '../core/project-context.js'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import { parseFrontmatter } from '../shared/utils.js'
import {
  authoringMarker,
  isObject,
  projectPath,
  readRecord,
  recordPath,
  skillEntries,
  skillKey,
  skillPath,
} from './project.js'
import { writeChanges } from './files.js'
import type { IntentFsCache } from '../discovery/fs-cache.js'
import type { MaintainerProject, SkillEntry } from './project.js'
import type { FileChange } from './files.js'

export interface AddSkillOptions {
  package?: string
  path?: string
  domain?: string
  description?: string
  source?: string | Array<string>
  requires?: string | Array<string>
  task?: string | Array<string>
}

interface PackageTarget {
  packageRoot: string
  manifestName: unknown
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
): { path: string; files: Array<string> } {
  const plan = planAddSkills(project, [{ name, options }])
  writeChanges(project.root, plan.changes)
  return {
    path: plan.paths[0]!,
    files: plan.changes.map((change) =>
      relative(project.root, change.path).replaceAll('\\', '/'),
    ),
  }
}

export function planAddSkills(
  project: MaintainerProject,
  additions: Array<{
    name: string | undefined
    options: AddSkillOptions
    frontmatter?: Record<string, unknown>
  }>,
  initialChanges: Array<FileChange> = [],
  onInvalid?: (index: number, error: unknown) => void,
  fsCache: IntentFsCache = createIntentFsCache(),
  checked: Set<string> = new Set(),
) {
  const changes = [...initialChanges]
  const tree = readRecord(project, 'skill_tree.yaml', changes, checked)
  const entries = skillEntries(project, tree, checked)
  const names = new Set(
    entries.map((entry) =>
      skillKey(entry.package, String(entry.slug ?? entry.name)),
    ),
  )
  const registeredPaths = new Set(
    entries.map((entry) => skillPath(project, entry, checked)),
  )
  const map = readRecord(project, 'domain_map.yaml', changes, checked)
  const mapSkills: Array<Record<string, unknown>> = map.document.toJS().skills
  const mappedNames = new Set(mapSkills.map((skill) => skill.slug))
  const specPath = recordPath(project, 'skill_spec.md', checked)
  const specChange = changes.find((change) => change.path === specPath)
  const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : null
  let nextSpec = specChange?.content ?? spec
  if (nextSpec === null)
    throw new Error('Missing skill_spec.md. Run intent maintainer setup.')
  const packages = new Map<string, PackageTarget>()
  const paths: Array<string> = []
  for (const [index, { name, options, frontmatter }] of additions.entries()) {
    let addition: ReturnType<typeof prepareAddition>
    try {
      addition = prepareAddition(
        project,
        name,
        options,
        names,
        registeredPaths,
        packages,
        fsCache,
        checked,
        frontmatter,
      )
    } catch (error) {
      if (!onInvalid) throw error
      onInvalid(index, error)
      continue
    }
    const { entry, path, packageDir, manifestName, tasks, change } = addition
    if (change) changes.push(change)
    names.add(skillKey(entry.package, String(entry.slug ?? entry.name)))
    registeredPaths.add(path)
    tree.document.addIn(['skills'], entry)
    if (!mappedNames.has(name)) {
      mappedNames.add(name)
      map.document.addIn(['skills'], {
        name,
        slug: name,
        domain: options.domain,
        description: entry.purpose ?? entry.description,
        ...(packageDir ? { packages: [manifestName] } : {}),
        tasks,
        covers: [],
      })
    }
    nextSpec = `${nextSpec.trimEnd()}\n\n- Registered \`${name}\` in \`${packageDir ?? '.'}\` (domain \`${options.domain}\`).${tasks.length ? ` Developer tasks: ${tasks.join('; ')}.` : ''} ${tasks.length ? 'Decisions and checks' : 'Task coverage, decisions, and checks'} still need to be recorded.\n`
    paths.push(join(packageDir ?? '', entry.path).replaceAll('\\', '/'))
  }
  if (paths.length) {
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

// Validate one candidate completely before adding it to the shared batch.
function prepareAddition(
  project: MaintainerProject,
  name: string | undefined,
  options: AddSkillOptions,
  names: Set<string>,
  registeredPaths: Set<string>,
  packages: Map<string, PackageTarget>,
  fsCache: IntentFsCache,
  checked: Set<string>,
  existingFrontmatter?: Record<string, unknown>,
) {
  if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error(
      'Choose a skill name of at most 64 lowercase letters, numbers, and hyphens.',
    )
  if (!options.domain?.trim())
    throw new Error('Choose the task domain with --domain <slug>.')
  const packageDir = options.package === '.' ? undefined : options.package
  if (names.has(skillKey(packageDir, name)))
    throw new Error(
      `Skill ${name} is already registered. Edit its SKILL.md, then run intent maintainer sync.`,
    )
  const entry: SkillEntry = {
    name,
    slug: name,
    domain: options.domain,
    ...(packageDir ? { package: packageDir } : {}),
    path: options.path ?? `skills/${name}/SKILL.md`,
  }
  const path = skillPath(project, entry, checked)
  if (basename(dirname(path)) !== name)
    throw new Error('The skill name must match its parent directory.')
  if (registeredPaths.has(path))
    throw new Error(`Skill path is already registered: ${entry.path}`)
  let pkg = packages.get(packageDir ?? '')
  if (!pkg) {
    const packageRoot = packageDir
      ? projectPath(project.root, packageDir, checked)
      : project.root
    projectPath(
      project.root,
      packageDir ? `${packageDir}/package.json` : 'package.json',
      checked,
    )
    const { packageJson: manifest, error } =
      fsCache.readPackageJsonResult(packageRoot)
    if (!manifest)
      throw error ?? new Error(`Invalid package.json: ${packageRoot}`)
    pkg = { packageRoot, manifestName: manifest.name }
    packages.set(packageDir ?? '', pkg)
  }
  if (
    resolveProjectContext({ cwd: project.root, targetPath: path, fsCache })
      .packageRoot !== pkg.packageRoot
  )
    throw new Error('The skill path must belong to the selected package.')
  let change: FileChange | undefined
  let frontmatter: Record<string, unknown>
  if (existingFrontmatter !== undefined || existsSync(path)) {
    if (options.description || options.source || options.requires)
      throw new Error(
        'To register an existing skill, supply its --path and --domain; edit its frontmatter directly before running sync.',
      )
    const parsed = existingFrontmatter ?? parseFrontmatter(path)
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
      metadata: { library: pkg.manifestName },
      sources,
      ...(options.requires
        ? { requires: stringList([options.requires].flat(), 'requires') }
        : {}),
    }
    change = {
      path,
      source: null,
      content: `---\n${stringify(frontmatter)}---\n\n${authoringMarker}\n\nWrite the task procedure, working examples, source-backed pitfalls, and completion checks. Add metadata.purpose in your own words. Remove the authoring marker after writing and checking the guidance.\n`,
    }
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
  const tasks = stringList(
    options.task === undefined ? [] : [options.task].flat(),
    'tasks',
  )
  return {
    entry,
    path,
    packageDir,
    manifestName: pkg.manifestName,
    tasks,
    change,
  }
}
