import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'

export const INSTALL_STATE_PATH = '.intent/install-state.json'

export interface InstallStateEntry {
  targetDirectory: string
  path: string
  alias: string
  source: { kind: 'npm' | 'workspace'; id: string }
  skillPath: string
  linkTarget: string
}

export interface InstallState {
  version: 1
  entries: Array<InstallStateEntry>
}

export type ReadInstallStateResult =
  | { status: 'missing' }
  | { status: 'malformed' }
  | { status: 'found'; state: InstallState }

function compareEntry(
  left: InstallStateEntry,
  right: InstallStateEntry,
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseEntry(value: unknown): InstallStateEntry | null {
  if (!isRecord(value) || !isRecord(value.source)) return null
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'alias,linkTarget,path,skillPath,source,targetDirectory')
    return null
  if (Object.keys(value.source).sort().join(',') !== 'id,kind') return null
  if (
    typeof value.targetDirectory !== 'string' ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    posix.isAbsolute(value.path) ||
    value.path.includes('\\') ||
    /^[A-Za-z]:/.test(value.path) ||
    value.path
      .split('/')
      .some(
        (segment) =>
          segment === '' ||
          segment === '.' ||
          segment === '..' ||
          /[. ]$/.test(segment),
      ) ||
    typeof value.alias !== 'string' ||
    typeof value.skillPath !== 'string' ||
    typeof value.linkTarget !== 'string' ||
    typeof value.source.id !== 'string' ||
    (value.source.kind !== 'npm' && value.source.kind !== 'workspace')
  ) {
    return null
  }
  return {
    targetDirectory: value.targetDirectory,
    path: value.path,
    alias: value.alias,
    source: { kind: value.source.kind, id: value.source.id },
    skillPath: value.skillPath,
    linkTarget: value.linkTarget,
  }
}

export function parseInstallState(text: string): InstallState | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.entries)
    ) {
      return null
    }
    if (Object.keys(parsed).sort().join(',') !== 'entries,version') return null
    const entries = parsed.entries.map(parseEntry)
    if (entries.some((entry) => entry === null)) return null
    const typed = entries as Array<InstallStateEntry>
    if (new Set(typed.map((entry) => entry.path)).size !== typed.length)
      return null
    return { version: 1, entries: [...typed].sort(compareEntry) }
  } catch {
    return null
  }
}

export function serializeInstallState(state: InstallState): string {
  return `${JSON.stringify({ version: 1, entries: [...state.entries].sort(compareEntry) }, null, 2)}\n`
}

export function readInstallState(root: string): ReadInstallStateResult {
  const path = join(root, INSTALL_STATE_PATH)
  if (!existsSync(path)) return { status: 'missing' }
  const state = parseInstallState(readFileSync(path, 'utf8'))
  return state ? { status: 'found', state } : { status: 'malformed' }
}

export function readInstallStateForLinks(root: string): ReadInstallStateResult {
  const result = readInstallState(root)
  if (result.status !== 'found') return result
  const projectRoot = resolve(root)
  const entries = result.state.entries.map((entry) => ({
    ...entry,
    path: resolve(projectRoot, ...entry.path.split('/')),
  }))
  if (
    entries.some((entry) => {
      const projectRelativePath = relative(projectRoot, entry.path)
      return (
        projectRelativePath === '..' ||
        projectRelativePath.startsWith(`..${sep}`) ||
        isAbsolute(projectRelativePath)
      )
    })
  ) {
    return { status: 'malformed' }
  }
  return {
    status: 'found',
    state: { version: 1, entries },
  }
}

export function writeInstallState(root: string, state: InstallState): boolean {
  const path = join(root, INSTALL_STATE_PATH)
  const content = serializeInstallState(state)
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  writeTextFileAtomic(path, content)
  return true
}
