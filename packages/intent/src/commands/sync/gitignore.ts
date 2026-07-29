import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'

const START = '# intent skill links:start'
const END = '# intent skill links:end'

export function updateIntentGitExclude(
  text: string | null,
  paths: ReadonlyArray<string>,
): string {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const prefix = text ?? ''
  const entries = [...new Set(paths)].sort()
  const block = [START, ...entries, END].join(eol)
  const matcher = new RegExp(
    `${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  )
  if (matcher.test(prefix)) return prefix.replace(matcher, block)
  if (prefix === '') return `${block}${eol}`
  const separator = prefix.endsWith('\n') ? '' : eol
  return `${prefix}${separator}${block}${eol}`
}

export function writeIntentGitExclude(
  root: string,
  paths: ReadonlyArray<string>,
): boolean {
  let gitPath: string
  try {
    gitPath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return false
  }
  if (gitPath === '') return false

  const path = resolve(root, gitPath)
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null
  const after = updateIntentGitExclude(before, paths)
  if (before === after) return false
  writeTextFileAtomic(path, after)
  return true
}
