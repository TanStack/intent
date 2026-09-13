import { relative } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { readDistribution } from './distribution.js'
import { readRecord, recordPath, skillEntries, skillPath } from './project.js'
import { writeChanges } from './files.js'
import type { MaintainerProject } from './project.js'
import type { FileChange } from './files.js'

// Retiring keeps the tree entry and the domain map history; only the status
// changes. The authored file stays on disk for the maintainer to delete.
export function retireSkill(
  project: MaintainerProject,
  name: string | undefined,
): { path: string; files: Array<string>; exists: boolean } {
  if (!name)
    throw new Error('Name the skill to remove: maintainer remove <name>.')
  const tree = readRecord(project, 'skill_tree.yaml')
  const entries = skillEntries(project, tree)
  const index = entries.findIndex(
    (entry) => (entry.slug ?? entry.name) === name,
  )
  const entry = entries[index]
  if (!entry) throw new Error(`Skill ${name} is not registered.`)
  if (entry.status === 'retired')
    throw new Error(`Skill ${name} is already retired.`)
  const distribution = readDistribution(tree)
  if (distribution?.mode === 'repo' && distribution.skills?.includes(name))
    throw new Error(
      `Skill ${name} is selected for repository distribution. Reselect the remaining skills with intent maintainer setup --distribution repo --skill <name>, or opt out with --distribution none, before removing it.`,
    )
  const dependents = entries.filter(
    (other) =>
      other !== entry &&
      !['planned', 'retired'].includes(String(other.status)) &&
      Array.isArray(other.requires) &&
      other.requires.includes(name),
  )
  if (dependents.length)
    throw new Error(
      `Skill ${name} is required by ${dependents
        .map((other) => other.slug ?? other.name)
        .join(', ')}. Update those prerequisites before removing it.`,
    )
  tree.document.setIn(['skills', index, 'status'], 'retired')
  const specPath = recordPath(project, 'skill_spec.md')
  const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : null
  if (spec === null)
    throw new Error('Missing skill_spec.md. Run intent maintainer setup.')
  const path = skillPath(project, entry)
  const relativePath = relative(project.root, path).replaceAll('\\', '/')
  const changes: Array<FileChange> = [
    { path: tree.path, source: tree.source, content: tree.document.toString() },
    {
      path: specPath,
      source: spec,
      content: `${spec.trimEnd()}\n\n- Retired \`${name}\` (${relativePath}). Record why its guidance is no longer needed.\n`,
    },
  ]
  writeChanges(project.root, changes)
  return {
    path: relativePath,
    files: changes.map((change) =>
      relative(project.root, change.path).replaceAll('\\', '/'),
    ),
    exists: existsSync(path),
  }
}
