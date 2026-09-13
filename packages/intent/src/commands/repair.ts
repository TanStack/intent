import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { resolveProjectContext } from '../core/project-context.js'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import { writeChanges } from '../maintainer/files.js'
import { fail } from '../shared/cli-error.js'
import { repositoryWritePath } from '../shared/write-path.js'
import { renderRepairPatch } from '../shared/patch.js'
import { planExampleRepairs } from '../validate/blocks.js'
import { planFrontmatterRepair } from '../validate/repairs.js'
import { collectDefaultSkillsDirs } from './validate.js'
import type { FileChange } from '../maintainer/files.js'

export interface RepairCommandOptions {
  write?: boolean
  json?: boolean
  patch?: boolean
}

export function runRepairCommand(
  dir: string | undefined,
  options: RepairCommandOptions,
) {
  if (options.patch && (options.write || options.json))
    fail('Cannot combine --patch with --write or --json')
  const context = resolveProjectContext({ cwd: process.cwd() })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  const { findSkillFiles } = createIntentFsCache()
  const directories =
    dir === undefined
      ? collectDefaultSkillsDirs(context, findSkillFiles)
      : [
          resolveProjectContext({ cwd: process.cwd(), targetPath: dir })
            .targetSkillsDir ?? resolve(dir),
        ]
  if (dir !== undefined && !existsSync(directories[0]!))
    fail(`Skills directory not found: ${dir}`)
  const paths = [...new Set(directories.flatMap(findSkillFiles))]
  if (dir !== undefined && !paths.length) fail('No SKILL.md files found')
  const report = {
    version: 1,
    repairs: [] as Array<{ file: string; changes: Array<string> }>,
    suggestions: [] as Array<{ file: string; line: number; message: string }>,
    problems: [] as Array<{ file: string; message: string }>,
  }
  const changes: Array<FileChange> = []
  const proposed: Array<FileChange & { source: string }> = []
  for (const path of paths) {
    const destination = repositoryWritePath(root, path)
    const file = relative(root, destination).replaceAll('\\', '/')
    const source = readFileSync(destination, 'utf8')
    const plan = planFrontmatterRepair(destination, source)
    report.problems.push(...plan.problems.map((message) => ({ file, message })))
    if (plan.change) {
      changes.push(plan.change)
      report.repairs.push({ file, changes: plan.changes })
    }
    const examples = planExampleRepairs(root, plan.change?.content ?? source)
    report.suggestions.push(
      ...examples.suggestions.map((suggestion) => ({ file, ...suggestion })),
    )
    if (examples.skipped)
      report.problems.push({ file, message: examples.skipped })
    if (examples.content !== source)
      proposed.push({ path: destination, source, content: examples.content })
  }
  if (options.write) writeChanges(root, changes)
  if (options.patch) process.stdout.write(renderRepairPatch(root, proposed))
  else if (options.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(
      `${report.repairs.length} file(s) ${options.write ? 'repaired' : 'with mechanical repairs'}, ${report.suggestions.length} suggestion(s), ${report.problems.length} problem(s).`,
    )
    for (const repair of report.repairs)
      console.log(`${repair.file}: ${repair.changes.join('; ')}`)
    for (const problem of report.problems)
      console.log(`${problem.file}: ${problem.message}`)
    for (const suggestion of report.suggestions)
      console.log(
        `${suggestion.file}:${suggestion.line}: ${suggestion.message}`,
      )
  }
  if (report.problems.length)
    fail(
      'Some repairs need assessment; resolve the reported problems and run repair again.',
    )
}
