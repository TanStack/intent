import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseFrontmatter } from '../shared/utils.js'

type Snapshot = Record<string, string | null>
type Outcome = 'updated' | 'no-change' | 'out-of-scope' | 'unresolved'

interface ReviewItem {
  id: string
  kind: 'skill' | 'source'
  path: string
  fingerprint: string
  snapshot: Snapshot
  changedFiles: Array<string>
  problems: Array<string>
  outcome?: Outcome
  reason?: string
  evidence?: Array<string>
}

export interface ReviewReport {
  schemaVersion: 1
  root: string
  head: string
  base: string
  items: Array<ReviewItem>
}

interface ReviewRecord {
  fingerprint: string
  snapshot: Snapshot
  head: string
  outcome: Exclude<Outcome, 'unresolved'>
  reason: string
  evidence: Array<string>
}

interface ReviewState {
  schemaVersion: 1
  baseline: string
  items: Record<string, ReviewRecord>
}

const statePath = '.intent/review-state.json'
const dependencyExclude = ':(top,exclude,glob)**/node_modules/**'
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const splitPaths = (value: string) => value.split('\0').filter(Boolean)

function git(root: string, args: Array<string>): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

function revision(root: string, ref: string): string {
  try {
    return git(root, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref}^{commit}`,
    ]).trim()
  } catch {
    throw new Error(
      `Cannot resolve review base ${JSON.stringify(ref)}. Fetch the referenced history or pass --base with an available commit.`,
    )
  }
}

function validatePath(path: string): void {
  const parts = path.split('/')
  if (
    parts.some((part) => part === '..' || part === '' || part === '.') ||
    path.includes('\\') ||
    path.includes('\0')
  ) {
    throw new Error(`Unsafe repository path: ${JSON.stringify(path)}`)
  }
}

function safePath(root: string, path: string): string {
  validatePath(path)
  const parts = path.split('/')
  let current = root
  for (const part of parts) {
    current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Cannot review symbolic link: ${JSON.stringify(path)}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return current
}

function fileHash(root: string, path: string): string | null {
  const absolute = safePath(root, path)
  try {
    if (!lstatSync(absolute).isFile())
      throw new Error(`Cannot review non-file: ${JSON.stringify(path)}`)
    return digest(readFileSync(absolute))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function hasEvidence(value: Record<string, unknown>): boolean {
  return (
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    Array.isArray(value.evidence) &&
    value.evidence.length > 0 &&
    value.evidence.every(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    )
  )
}

function resolvedOutcome(value: unknown): value is ReviewRecord['outcome'] {
  return (
    value === 'updated' || value === 'no-change' || value === 'out-of-scope'
  )
}

function readState(root: string): {
  state: ReviewState | null
  content: string | null
} {
  const path = safePath(root, statePath)
  if (!existsSync(path)) return { state: null, content: null }
  const content = readFileSync(path, 'utf8')
  try {
    const value: unknown = JSON.parse(content)
    if (
      !isObject(value) ||
      value.schemaVersion !== 1 ||
      typeof value.baseline !== 'string' ||
      !/^[a-f0-9]{40,64}$/.test(value.baseline) ||
      !isObject(value.items)
    )
      throw new Error()
    for (const item of Object.values(value.items)) {
      if (
        !isObject(item) ||
        !isHash(item.fingerprint) ||
        !isObject(item.snapshot) ||
        !Object.values(item.snapshot).every(
          (hash) => hash === null || isHash(hash),
        ) ||
        typeof item.head !== 'string' ||
        !/^[a-f0-9]{40,64}$/.test(item.head) ||
        !resolvedOutcome(item.outcome) ||
        !hasEvidence(item)
      )
        throw new Error()
      for (const path of Object.keys(item.snapshot)) validatePath(path)
    }
    return { state: value as unknown as ReviewState, content }
  } catch {
    throw new Error(
      `Invalid review state at ${statePath}. Restore or repair it before recording another review.`,
    )
  }
}

function repositoryName(value: unknown): string | undefined {
  if (isObject(value)) return repositoryName(value.url)
  if (typeof value !== 'string') return undefined
  let path = value
  if (value.startsWith('git@github.com:')) {
    path = value.slice('git@github.com:'.length)
  } else if (value.includes('://')) {
    try {
      const url = new URL(value)
      if (url.hostname !== 'github.com') return undefined
      path = url.pathname.slice(1)
    } catch {
      return undefined
    }
  } else if (value.startsWith('github:')) {
    path = value.slice('github:'.length)
  }
  return path.match(/^([^/:\s]+\/[^/:\s]+?)(?:\.git)?\/?$/)?.[1]?.toLowerCase()
}

function repositoryNames(root: string): Set<string> {
  const names = new Set<string>()
  try {
    const name = repositoryName(
      git(root, ['config', '--get', 'remote.origin.url']).trim(),
    )
    if (name) names.add(name)
  } catch {
    /* A local repository need not have a remote. */
  }
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(safePath(root, 'package.json'), 'utf8'),
    )
    const name = isObject(manifest)
      ? repositoryName(manifest.repository)
      : undefined
    if (name) names.add(name)
  } catch {
    /* Plain package-relative sources do not need repository metadata. */
  }
  return names
}

function sourcePattern(
  source: string,
  packageDir: string,
  names: Set<string>,
): string {
  const colon = source.indexOf(':')
  let path = source
  if (colon >= 0) {
    if (!names.has(source.slice(0, colon).toLowerCase()))
      throw new Error(`Source belongs to an unverified repository: ${source}`)
    path = source.slice(colon + 1)
  } else if (packageDir) {
    path = `${packageDir}/${source}`
  }
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes(':') ||
    path.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new Error(`Unsupported source path: ${source}`)
  }
  // Git owns glob matching; braces and extglobs are not Git pathspec syntax.
  if (/[{}]/.test(path) || /[!+@?*]\(/.test(path))
    throw new Error(
      `Unsupported source glob: ${source}. Use Git glob syntax (*, ?, [], **).`,
    )
  return `:(top,glob)${path}`
}

function snapshot(
  root: string,
  paths: Array<string>,
  problems: Array<string>,
): Snapshot {
  return Object.fromEntries(
    sorted(paths).map((path) => {
      try {
        return [path, fileHash(root, path)]
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error))
        return [path, null]
      }
    }),
  )
}

export function createReview(cwd: string, baseRef?: string): ReviewReport {
  let root: string
  try {
    root = git(resolve(cwd), ['rev-parse', '--show-toplevel']).trim()
  } catch {
    throw new Error(
      'Skill review requires a Git working tree with an initial commit.',
    )
  }
  const head = revision(root, 'HEAD')
  if (git(root, ['ls-files', '--unmerged', '-z']))
    throw new Error('Resolve Git conflicts before reviewing skills.')
  const { state } = readState(root)
  const base = revision(root, baseRef ?? state?.baseline ?? head)
  const list = (patterns: Array<string> = []) =>
    splitPaths(
      git(root, [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        ...patterns,
        dependencyExclude,
      ]),
    )
  const diff = (patterns: Array<string> = []) =>
    splitPaths(
      git(root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--name-only',
        '-z',
        base,
        '--',
        ...patterns,
        dependencyExclude,
      ]),
    )
  const files = sorted(list())
  const changed = sorted([
    ...diff(),
    ...splitPaths(
      git(root, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        dependencyExclude,
      ]),
    ),
  ])
  const names = repositoryNames(root)
  const covered = new Set<string>()
  const items: Array<ReviewItem> = []
  function add(
    kind: ReviewItem['kind'],
    path: string,
    paths: Array<string>,
    problems: Array<string>,
  ) {
    const id = `${kind}:${path}`
    const current = snapshot(root, paths, problems)
    const previous = state?.items[id]
    const fingerprint = digest(JSON.stringify([id, current, problems]))
    if (previous?.fingerprint === fingerprint && problems.length === 0) return
    const changedFiles = sorted([
      ...Object.keys(current),
      ...Object.keys(previous?.snapshot ?? {}),
    ]).filter((file) =>
      previous
        ? current[file] !== previous.snapshot[file]
        : changed.includes(file),
    )
    items.push({
      id,
      kind,
      path,
      fingerprint,
      snapshot: current,
      changedFiles,
      problems,
    })
  }
  for (const file of files.filter((path) =>
    /(^|\/)skills\/.+\/SKILL\.md$/.test(path),
  )) {
    const problems: Array<string> = []
    const skillDir = dirname(file)
    const guidanceFiles = files.filter((path) =>
      path.startsWith(`${skillDir}/`),
    )
    let frontmatter: Record<string, unknown> | null
    try {
      if (fileHash(root, file) === null) continue
      frontmatter = parseFrontmatter(safePath(root, file))
    } catch (error) {
      add(
        'skill',
        file,
        [file],
        [error instanceof Error ? error.message : String(error)],
      )
      continue
    }
    const sources = frontmatter?.sources
    const sourceFiles: Array<string> = []
    if (!Array.isArray(sources) || sources.length === 0)
      problems.push(
        'No source paths declared. Add the evidence used to author this skill.',
      )
    else {
      const packageDir = file.slice(0, file.search(/(^|\/)skills\//))
      for (const source of sources) {
        try {
          if (typeof source !== 'string')
            throw new Error('Source entries must be strings.')
          const pattern = sourcePattern(source, packageDir, names)
          const matches = sorted([...list([pattern]), ...diff([pattern])])
          if (matches.length === 0)
            throw new Error(`Source matched no available files: ${source}`)
          sourceFiles.push(...matches)
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error))
        }
      }
    }
    for (const path of [...sourceFiles, ...guidanceFiles]) covered.add(path)
    add('skill', file, [...sourceFiles, ...guidanceFiles], problems)
  }
  for (const path of changed) {
    if (covered.has(path) || path.startsWith('.intent/')) continue
    add('source', path, [path], [])
  }
  for (const id of Object.keys(state?.items ?? {})) {
    if (!id.startsWith('skill:')) continue
    const path = id.slice('skill:'.length)
    if (files.includes(path)) continue
    if (fileHash(root, path) === null && !changed.includes(path)) {
      add('source', path, [path], [])
    }
  }
  return { schemaVersion: 1, root, head, base, items }
}

export function recordReview(cwd: string, input: unknown): number {
  if (
    !isObject(input) ||
    input.schemaVersion !== 1 ||
    typeof input.base !== 'string' ||
    !Array.isArray(input.items)
  )
    throw new Error(
      'Expected an intent review --json report with annotated outcomes.',
    )
  const current = createReview(cwd, input.base)
  if (input.root !== current.root)
    throw new Error('This review report belongs to a different working tree.')
  const { state, content } = readState(current.root)
  const records: Record<string, ReviewRecord> = { ...state?.items }
  const seen = new Set<string>()
  let count = 0
  for (const value of input.items) {
    if (!isObject(value) || typeof value.id !== 'string' || seen.has(value.id))
      throw new Error('Invalid or duplicate review item.')
    seen.add(value.id)
    if (value.outcome === undefined || value.outcome === 'unresolved') continue
    if (!resolvedOutcome(value.outcome) || !hasEvidence(value))
      throw new Error(
        `Review ${value.id} requires a supported outcome, reason and evidence.`,
      )
    const item = current.items.find((entry) => entry.id === value.id)
    if (!item || item.fingerprint !== value.fingerprint)
      throw new Error(
        `Review ${value.id} changed since this report. Run intent review --json again after editing.`,
      )
    if (item.problems.length > 0)
      throw new Error(
        `Review ${value.id} has unresolved source evidence. Fix the source mapping before recording it.`,
      )
    records[item.id] = {
      fingerprint: item.fingerprint,
      snapshot: item.snapshot,
      head: current.head,
      outcome: value.outcome,
      reason: value.reason as string,
      evidence: value.evidence as Array<string>,
    }
    count++
  }
  if (count === 0) return 0
  const path = safePath(current.root, statePath)
  mkdirSync(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  writeFileSync(lock, '', { flag: 'wx' })
  try {
    if (readState(current.root).content !== content)
      throw new Error(
        'Review state changed while recording. Retry with a fresh report.',
      )
    const next: ReviewState = {
      schemaVersion: 1,
      baseline: state?.baseline ?? current.base,
      items: records,
    }
    writeFileSync(lock, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(lock, path)
  } finally {
    rmSync(lock, { force: true })
  }
  return count
}
