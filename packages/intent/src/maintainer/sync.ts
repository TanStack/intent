import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { resolveProjectContext } from '../core/project-context.js'
import { parseFrontmatter } from '../shared/utils.js'
import { stringList } from './add.js'
import {
  authoringMarker,
  isObject,
  projectPath,
  readRecord,
  recordPath,
  skillEntries,
  skillPath,
} from './project.js'
import type { ParseError } from 'jsonc-parser'
import type { MaintainerProject } from './project.js'
import type { FileChange } from './files.js'

export function planMaintainerSync(project: MaintainerProject) {
  const tree = readRecord(project, 'skill_tree.yaml')
  const map = readRecord(project, 'domain_map.yaml').document.toJS()
  const entries = skillEntries(project)
  const changes: Array<FileChange> = []
  const problems: Array<string> = []
  const packages = new Map<string, Array<string>>()
  const skills: Array<string> = []
  const names = new Set(
    entries
      .filter((entry) => !['planned', 'retired'].includes(String(entry.status)))
      .map((entry) => String(entry.slug ?? entry.name)),
  )
  const dependencies = new Map<string, Array<string>>()
  tree.document.setIn(
    ['generated_from', 'domain_map'],
    relative(project.root, recordPath(project, 'domain_map.yaml')).replaceAll(
      '\\',
      '/',
    ),
  )
  tree.document.setIn(
    ['generated_from', 'skill_spec'],
    relative(project.root, recordPath(project, 'skill_spec.md')).replaceAll(
      '\\',
      '/',
    ),
  )
  for (const [index, entry] of entries.entries()) {
    if (['planned', 'retired'].includes(String(entry.status))) continue
    const path = skillPath(project, entry)
    if (!existsSync(path)) {
      problems.push(`Missing skill: ${entry.path}`)
      continue
    }
    const fm = parseFrontmatter(path)
    if (
      !isObject(fm) ||
      typeof fm.description !== 'string' ||
      !fm.description.trim()
    )
      throw new Error(`Invalid skill frontmatter: ${entry.path}`)
    const name = String(entry.slug ?? entry.name)
    if (fm.name !== name)
      throw new Error(
        `Skill identity differs from its tree entry: ${entry.path}`,
      )
    const sources = stringList(fm.sources ?? [], `${name} sources`)
    const requires = stringList(fm.requires ?? [], `${name} requires`)
    dependencies.set(
      name,
      requires.filter((dependency) => names.has(dependency)),
    )
    for (const dependency of requires) {
      if (
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dependency) &&
        !names.has(dependency)
      )
        problems.push(
          `${name}: prerequisite ${dependency} is not an implemented skill in this tree.`,
        )
    }
    for (const [field, value] of Object.entries({
      description: fm.description,
      purpose: isObject(fm.metadata) ? fm.metadata.purpose : undefined,
      sources,
      requires,
    })) {
      if (JSON.stringify(entry[field]) === JSON.stringify(value)) continue
      if (value === undefined) tree.document.deleteIn(['skills', index, field])
      else tree.document.setIn(['skills', index, field], value)
    }
    if (readFileSync(path, 'utf8').includes(authoringMarker))
      problems.push(`${name}: skill still needs authoring.`)
    const mapped = map.skills.find(
      (skill: unknown) => isObject(skill) && skill.slug === name,
    )
    if (!mapped || mapped.domain !== entry.domain)
      problems.push(
        `${name}: reconcile its task/domain entry in domain_map.yaml.`,
      )
    if (
      !mapped ||
      !Array.isArray(mapped.tasks) ||
      !mapped.tasks.length ||
      mapped.tasks.some(
        (task: unknown) => typeof task !== 'string' || !task.trim(),
      )
    )
      problems.push(
        `${name}: record the assessed developer tasks in domain_map.yaml.`,
      )
    skills.push(path)
    const context = resolveProjectContext({
      cwd: project.root,
      targetPath: path,
    })
    const packageRoot = entry.package
      ? projectPath(project.root, entry.package)
      : project.root
    if (context.packageRoot !== packageRoot)
      throw new Error(
        `Skill ownership differs from its tree entry: ${entry.path}`,
      )
    const packagePath = projectPath(
      project.root,
      entry.package ? `${entry.package}/package.json` : 'package.json',
    )
    const directories = packages.get(packagePath) ?? []
    directories.push(relative(packageRoot, dirname(path)).replaceAll('\\', '/'))
    packages.set(packagePath, directories)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(name: string) {
    if (visiting.has(name))
      throw new Error(`Cyclic skill prerequisite: ${name}`)
    if (visited.has(name)) return
    visiting.add(name)
    for (const dependency of dependencies.get(name) ?? []) visit(dependency)
    visiting.delete(name)
    visited.add(name)
  }
  for (const name of dependencies.keys()) visit(name)
  for (const [path, directories] of packages) {
    const source = readFileSync(path, 'utf8')
    const errors: Array<ParseError> = []
    const manifest: unknown = parse(source, errors, {
      allowTrailingComma: true,
    })
    if (errors.length || !isObject(manifest))
      throw new Error(`Invalid package.json: ${path}`)
    let content = source
    const indent = source.match(/\n([\t ]+)"/)?.[1] ?? '  '
    const options = {
      formattingOptions: {
        insertSpaces: !indent.includes('\t'),
        tabSize: indent.length,
        eol: source.includes('\r\n') ? '\r\n' : '\n',
      },
    }
    const keywords = stringList(manifest.keywords ?? [], `${path} keywords`)
    if (!keywords.includes('tanstack-intent'))
      content = applyEdits(
        content,
        modify(
          content,
          ['keywords'],
          [...keywords, 'tanstack-intent'],
          options,
        ),
      )
    // Without a files allowlist npm includes files by default; adding one would drop unrelated package contents.
    if (manifest.files !== undefined) {
      const files = stringList(manifest.files, `${path} files`)
      const additions = directories.filter(
        (directory) =>
          !files.some(
            (file) =>
              directory === file ||
              directory.startsWith(`${file.replace(/\/\*\*$|\/$/, '')}/`),
          ),
      )
      if (additions.length)
        content = applyEdits(
          content,
          modify(
            content,
            ['files'],
            [...files, ...new Set(additions)],
            options,
          ),
        )
    }
    if (source !== content) changes.push({ path, source, content })
  }
  const nextTree = tree.document.toString()
  if (
    JSON.stringify(tree.document.toJS()) !==
    JSON.stringify(readRecord(project, 'skill_tree.yaml').document.toJS())
  )
    changes.push({ path: tree.path, source: tree.source, content: nextTree })
  const spec = readFileSync(recordPath(project, 'skill_spec.md'), 'utf8')
  if (!spec.trim() || spec.includes(authoringMarker))
    problems.push('skill_spec.md still needs authored coverage and decisions.')
  return { changes, problems, skills }
}
