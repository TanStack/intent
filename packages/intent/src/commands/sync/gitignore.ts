import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'

const START = '# intent skill links:start'
const END = '# intent skill links:end'
const INTENT_STATE = '.intent/'

function updateIntentGitignore(text: string | null): string {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const lines = (text ?? '').split(/\r?\n/)
  if (lines.includes(INTENT_STATE)) return text ?? `${INTENT_STATE}${eol}`

  const prefix = text ?? ''
  const separator = prefix === '' || prefix.endsWith('\n') ? '' : eol
  return `${prefix}${separator}${INTENT_STATE}${eol}`
}

export function writeIntentGitignore(root: string): boolean {
  const path = join(root, '.gitignore')
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null
  const after = updateIntentGitignore(before)
  if (before === after) return false
  writeTextFileAtomic(path, after)
  return true
}

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
  let gitRoot: string
  try {
    gitPath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return false
  }
  if (gitPath === '' || gitRoot === '') return false

  const path = isAbsolute(gitPath) ? gitPath : resolve(root, gitPath)
  const entries = paths.map((entry) =>
    relative(gitRoot, resolve(root, entry)).replace(/\\/g, '/'),
  )
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null
  const after = updateIntentGitExclude(before, entries)
  if (before === after) return false
  writeTextFileAtomic(path, after)
  return true
}
