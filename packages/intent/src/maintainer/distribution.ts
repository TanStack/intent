import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { applyEdits, modify } from 'jsonc-parser'
import { parseFrontmatter } from '../shared/utils.js'
import { stringList } from './add.js'
import {
  authoringMarker,
  isObject,
  projectPath,
  readRecord,
  skillEntries,
  skillPath,
} from './project.js'
import { writeChanges } from './files.js'
import type { MaintainerProject, SkillEntry } from './project.js'
import type { FileChange } from './files.js'

export interface DistributionOptions {
  distribution?: string
  repository?: string
  pluginName?: string
  skill?: string | Array<string>
}

export interface Distribution {
  mode: 'repo' | 'none'
  repository?: string
  name?: string
  skills?: Array<string>
}

const repositoryPattern =
  /^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function readDistribution(
  tree: ReturnType<typeof readRecord>,
): Distribution | undefined {
  const value: unknown = tree.document.toJS().distribution
  if (value === undefined) return undefined
  if (!isObject(value) || !['repo', 'none'].includes(String(value.mode)))
    throw new Error('skill_tree.yaml distribution.mode must be repo or none.')
  if (value.mode === 'repo' || value.name !== undefined) {
    if (
      typeof value.repository !== 'string' ||
      !repositoryPattern.test(value.repository) ||
      typeof value.name !== 'string' ||
      !namePattern.test(value.name)
    )
      throw new Error(
        'Repository distribution requires an owner/repo repository and a kebab-case plugin name.',
      )
    if (!stringList(value.skills, 'distribution.skills').length)
      throw new Error('Choose at least one distribution skill.')
  }
  return value as unknown as Distribution
}

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isObject(value)) throw new Error(`Expected a JSON object: ${path}`)
  return value
}

function inferDistributionRepository(
  project: MaintainerProject,
): string {
  const manifest = readJson(projectPath(project.root, 'package.json'))
  const declared = isObject(manifest.repository)
    ? manifest.repository.url
    : manifest.repository
  return typeof declared === 'string'
    ? declared
        .replace(/^git\+/, '')
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/^git@github\.com:/, '')
        .replace(/\.git$/, '')
    : ''
}

export function configureDistribution(
  project: MaintainerProject,
  options: DistributionOptions,
): void {
  const change = planDistributionChoice(project, options)
  if (change) writeChanges(project.root, [change])
}

function planDistributionChoice(
  project: MaintainerProject,
  options: DistributionOptions,
  changes: ReadonlyArray<FileChange> = [],
): FileChange | undefined {
  if (!options.distribution) {
    if (options.repository || options.pluginName || options.skill)
      throw new Error(
        'Use --distribution repo when choosing repository skills.',
      )
    return
  }
  if (!['repo', 'none'].includes(options.distribution))
    throw new Error('--distribution must be repo or none.')
  const tree = readRecord(project, 'skill_tree.yaml', changes)
  const previous = readDistribution(tree)
  let distribution: Distribution
  if (options.distribution === 'none') {
    if (options.repository || options.pluginName || options.skill)
      throw new Error(
        '--distribution none does not take repository, plugin-name, or skill options.',
      )
    distribution = { ...previous, mode: 'none' }
  } else {
    const repository =
      options.repository ??
      previous?.repository ??
      inferDistributionRepository(project)
    const missing: Array<string> = []
    if (!repositoryPattern.test(repository))
      missing.push('a GitHub repository with --repository <owner/repo>')
    const existingManifest = projectPath(
      project.root,
      '.claude-plugin/plugin.json',
    )
    const existingName = existsSync(existingManifest)
      ? readJson(existingManifest).name
      : undefined
    const name =
      options.pluginName ??
      previous?.name ??
      (typeof existingName === 'string'
        ? existingName
        : repository
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-$/, ''))
    if (!namePattern.test(name))
      missing.push('a kebab-case name with --plugin-name <name>')
    if (previous?.name && previous.name !== name)
      throw new Error(
        `Keep the existing plugin name ${previous.name}; renaming a published plugin requires a separate migration.`,
      )
    const skills = options.skill
      ? stringList([options.skill].flat(), '--skill')
      : (previous?.skills ?? [])
    if (!skills.length)
      missing.push(
        'the public skills with --skill <name> (repeat for multiple skills)',
      )
    if (missing.length)
      throw new Error(`Repository distribution needs: ${missing.join('; ')}.`)
    const entries = skillEntries(project, tree)
    for (const selected of skills) {
      const entry = entries.find(
        (skill) => (skill.slug ?? skill.name) === selected,
      )
      if (!entry || ['planned', 'retired'].includes(String(entry.status)))
        throw new Error(
          `Distribution skill is not an implemented tree entry: ${selected}`,
        )
      if (!existsSync(skillPath(project, entry)))
        throw new Error(`Distribution skill is missing: ${selected}`)
    }
    distribution = { mode: 'repo', repository, name, skills }
  }
  if (JSON.stringify(previous) === JSON.stringify(distribution)) return
  tree.document.set('distribution', distribution)
  return {
    path: tree.path,
    source: tree.source,
    content: tree.document.toString(),
  }
}

function jsonChange(
  project: MaintainerProject,
  path: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>,
): FileChange | undefined {
  const absolute = projectPath(project.root, path)
  const source = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
  const current = source === null ? {} : readJson(absolute)
  const fields = update(current)
  let content = source ?? '{}\n'
  const indent = content.match(/\n([\t ]+)"/)?.[1] ?? '  '
  const options = {
    formattingOptions: {
      insertSpaces: !indent.includes('\t'),
      tabSize: indent.length,
      eol: content.includes('\r\n') ? '\r\n' : '\n',
    },
  }
  for (const [field, value] of Object.entries(fields)) {
    if (JSON.stringify(current[field]) !== JSON.stringify(value))
      content = applyEdits(content, modify(content, [field], value, options))
  }
  return content === source ? undefined : { path: absolute, source, content }
}

function shellCommand(args: Array<string>): string {
  return args
    .map((arg) =>
      /^[a-zA-Z0-9_./@#-]+$/.test(arg)
        ? arg
        : `'${arg.replaceAll("'", "'\\''")}'`,
    )
    .join(' ')
}

export function planDistribution(
  project: MaintainerProject,
  tree: ReturnType<typeof readRecord>,
  entries: ReadonlyArray<SkillEntry>,
) {
  // Package-only distribution is the default; repository distribution is an
  // explicit opt-in through maintainer setup --distribution repo.
  const config = readDistribution(tree) ?? { mode: 'none' as const }
  const changes: Array<FileChange> = []
  const problems: Array<string> = []
  const commands: Array<string> = []
  if (config.mode === 'none' && !config.name)
    return { changes, problems, commands, mode: config.mode }
  const { name, repository } = config
  const selected = config.mode === 'repo' ? config.skills! : []
  const exported: Array<{ name: string; path: string }> = []
  for (const selectedName of selected) {
    const entry = entries.find(
      (skill) => (skill.slug ?? skill.name) === selectedName,
    )
    if (!entry || ['planned', 'retired'].includes(String(entry.status)))
      throw new Error(`Distribution skill is not implemented: ${selectedName}`)
    const path = skillPath(project, entry)
    const fm = parseFrontmatter(path)
    if (
      !isObject(fm) ||
      fm.name !== selectedName ||
      !namePattern.test(selectedName)
    )
      throw new Error(`Invalid distribution skill identity: ${selectedName}`)
    if (readFileSync(path, 'utf8').includes(authoringMarker))
      throw new Error(
        `Finish authoring ${selectedName} before generating distribution files.`,
      )
    for (const dependency of stringList(
      fm.requires ?? [],
      `${selectedName} requires`,
    )) {
      if (
        entries.some((skill) => (skill.slug ?? skill.name) === dependency) &&
        !selected.includes(dependency)
      )
        throw new Error(
          `Select prerequisite ${dependency} explicitly alongside ${selectedName}.`,
        )
    }
    exported.push({
      name: selectedName,
      path: relative(project.root, path).replaceAll('\\', '/'),
    })
  }
  const paths = exported.map(
    (skill) => `./${dirname(skill.path).replaceAll('\\', '/')}`,
  )
  for (const directory of ['.claude-plugin', '.cursor-plugin']) {
    const pluginPath = `${directory}/plugin.json`
    if (
      config.mode === 'repo' ||
      existsSync(projectPath(project.root, pluginPath))
    ) {
      const change = jsonChange(project, pluginPath, (current) => {
        if (current.name !== undefined && current.name !== name)
          throw new Error(
            `${pluginPath} belongs to plugin ${String(current.name)}, not ${name}.`,
          )
        return { name, skills: paths }
      })
      if (change) changes.push(change)
    }
    const marketplacePath = `${directory}/marketplace.json`
    if (
      config.mode === 'repo' ||
      existsSync(projectPath(project.root, marketplacePath))
    ) {
      const change = jsonChange(project, marketplacePath, (current) => {
        if (
          current.metadata !== undefined &&
          (!isObject(current.metadata) ||
            (current.metadata.pluginRoot !== undefined &&
              !['', '.', './'].includes(String(current.metadata.pluginRoot))))
        )
          throw new Error(
            `${marketplacePath} metadata.pluginRoot must use the repository root for selected skill distribution.`,
          )
        if (
          current.name !== undefined &&
          (typeof current.name !== 'string' || !namePattern.test(current.name))
        )
          throw new Error(`Invalid marketplace name in ${marketplacePath}.`)
        if (
          current.owner !== undefined &&
          (!isObject(current.owner) ||
            typeof current.owner.name !== 'string' ||
            !current.owner.name.trim())
        )
          throw new Error(`Invalid marketplace owner in ${marketplacePath}.`)
        if (
          current.plugins !== undefined &&
          (!Array.isArray(current.plugins) ||
            current.plugins.some((plugin) => !isObject(plugin)))
        )
          throw new Error(`Invalid plugins array in ${marketplacePath}.`)
        const plugins = (current.plugins ?? []) as Array<
          Record<string, unknown>
        >
        const existing = plugins.filter((plugin) => plugin.name === name)
        if (existing.length > 1)
          throw new Error(`Duplicate plugin ${name} in ${marketplacePath}.`)
        if (
          existing[0]?.source !== undefined &&
          !['.', './'].includes(String(existing[0].source))
        )
          throw new Error(
            `Plugin ${name} in ${marketplacePath} uses a different source.`,
          )
        if (
          config.mode === 'repo' &&
          directory === '.claude-plugin' &&
          existing[0]?.strict === false
        )
          throw new Error(
            `Plugin ${name} in ${marketplacePath} uses strict: false, which conflicts with the generated plugin.json components. Use strict: true or omit strict before syncing.`,
          )
        const next = plugins.filter((plugin) => plugin.name !== name)
        if (config.mode === 'repo')
          next.push({ ...existing[0], name, source: './', skills: paths })
        return {
          name: current.name ?? name,
          owner: current.owner ?? { name: repository!.split('/')[0] },
          plugins: next,
        }
      })
      if (change) changes.push(change)
    }
  }
  const install =
    config.mode === 'repo'
      ? {
          skills: [
            'npx',
            'skills',
            'add',
            repository!,
            '--full-depth',
            '--skill',
            ...selected,
          ],
          github: exported.map((skill) => [
            'gh',
            'skill',
            'add',
            repository!,
            skill.path,
          ]),
        }
      : { skills: [], github: [] }
  const inventory = jsonChange(
    project,
    '.intent/skill-distribution.json',
    () => ({
      schemaVersion: 1,
      mode: config.mode,
      repository,
      skills: exported,
      install,
    }),
  )
  if (inventory) changes.push(inventory)
  if (config.mode === 'repo') {
    commands.push(
      shellCommand(install.skills),
      ...install.github.map(shellCommand),
    )
    const marketplace = projectPath(
      project.root,
      '.claude-plugin/marketplace.json',
    )
    const marketplaceName = existsSync(marketplace)
      ? (readJson(marketplace).name ?? name)
      : name
    commands.push(
      `/plugin marketplace add ${repository}`,
      `/plugin install ${name}@${String(marketplaceName)}`,
    )
  }
  return { changes, problems, commands, mode: config.mode }
}
