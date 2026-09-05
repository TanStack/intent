import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { main } from '../src/cli.js'
import { createReview, recordReview } from '../src/review/review.js'

let root: string
function git(...args: Array<string>) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
}
function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
function skill(sources = ['acme/library:src/**/*.ts']) {
  write(
    'skills/request/SKILL.md',
    `---\nname: request\ndescription: Request safely\nsources: ${JSON.stringify(sources)}\n---\nUse request.\n`,
  )
}
function accept(report = createReview(root)) {
  for (const item of report.items) {
    item.outcome = 'no-change'
    item.reason = 'Compared the source with the documented request behavior.'
    item.evidence = ['src/request.ts', 'npm test: passed']
  }
  return recordReview(root, report)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'intent-review-'))
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  write(
    'package.json',
    '{"name":"library","repository":"https://github.com/acme/library"}\n',
  )
  write('src/request.ts', 'export const attempts = 3\n')
  skill()
  git('add', '.')
  git('commit', '-qm', 'fixture')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('reviews an initial skill and remembers a justified no-op', () => {
  const report = createReview(root)
  expect(report.items.map((item) => item.id)).toEqual([
    'skill:skills/request/SKILL.md',
  ])
  accept(report)
  expect(createReview(root).items).toEqual([])
})

it('reopens source edits and remembers their review before and after commit', () => {
  accept()
  write('src/request.ts', 'export const attempts = 4\n')
  const report = createReview(root)
  expect(report.items[0]?.changedFiles).toEqual(['src/request.ts'])
  accept(report)
  expect(createReview(root).items).toEqual([])
  git('add', 'src/request.ts')
  git('commit', '-qm', 'changed')
  expect(createReview(root).items).toEqual([])
})

it('reopens changes to a skill reference', () => {
  accept()
  write('skills/request/references/errors.md', 'Errors propagate.\n')
  expect(createReview(root).items[0]?.changedFiles).toEqual([
    'skills/request/references/errors.md',
  ])
})

it('excludes installed dependencies even without a gitignore entry', () => {
  write(
    'node_modules/installed/skills/task/SKILL.md',
    '---\nname: task\n---\nInstalled dependency\n',
  )
  write('packages/client/node_modules/installed/src/index.ts', 'dependency\n')
  expect(createReview(root).items.map((item) => item.id)).toEqual([
    'skill:skills/request/SKILL.md',
  ])
})

it('includes staged, unstaged, untracked and deleted paths and uses Git glob semantics', () => {
  accept()
  write('src/nested/more.ts', 'new source\n')
  write('src/staged.ts', 'staged\n')
  git('add', 'src/staged.ts')
  rmSync(join(root, 'src/request.ts'))
  const item = createReview(root).items[0]!
  expect(item.changedFiles).toEqual([
    'src/nested/more.ts',
    'src/request.ts',
    'src/staged.ts',
  ])
  expect(item.problems).toEqual([])
})

it('shows new unmapped areas on a later committed release and remembers reviewed exclusions', () => {
  accept()
  write('adapters/new.ts', 'new task\n')
  git('add', 'adapters')
  git('commit', '-qm', 'new adapter')
  const report = createReview(root)
  expect(report.items.map((item) => item.id)).toEqual([
    'source:adapters/new.ts',
  ])
  accept()
  expect(createReview(root).items).toEqual([])
  write('adapters/new.ts', 'changed task\n')
  expect(createReview(root).items[0]?.id).toBe('source:adapters/new.ts')
})

it('uses an explicit comparison base and rejects missing or option-like revisions', () => {
  const base = git('rev-parse', 'HEAD')
  write('docs/new.md', 'New behavior\n')
  git('add', '.')
  git('commit', '-qm', 'docs')
  expect(
    createReview(root, base).items.some(
      (item) => item.id === 'source:docs/new.md',
    ),
  ).toBe(true)
  expect(() => createReview(root, 'missing-branch')).toThrow(
    /Cannot resolve review base/,
  )
  expect(() => createReview(root, '--all')).toThrow(
    /Cannot resolve review base/,
  )
})

it('keeps unavailable, foreign and unsafe source evidence unresolved', () => {
  skill(['other/library:src/request.ts', '../outside', 'src/missing.ts'])
  const report = createReview(root)
  expect(report.items[0]?.problems).toHaveLength(3)
  expect(() => accept()).toThrow(/unresolved source evidence/)
})

it('does not treat a lookalike remote hostname as the declared GitHub repository', () => {
  write(
    'package.json',
    '{"repository":"https://evilgithub.com/acme/library"}\n',
  )
  expect(
    createReview(root)
      .items.find((item) => item.kind === 'skill')
      ?.problems.join(' '),
  ).toContain('unverified repository')
})

it('rejects acknowledgements after source changes, without touching prior state', () => {
  accept()
  const original = readFileSync(join(root, '.intent/review-state.json'), 'utf8')
  write('src/request.ts', 'changed\n')
  const report = createReview(root)
  report.items[0]!.outcome = 'updated'
  report.items[0]!.reason = 'Updated the example.'
  report.items[0]!.evidence = ['npm test: passed']
  write('src/request.ts', 'changed again\n')
  expect(() => recordReview(root, report)).toThrow(/changed since this report/)
  expect(readFileSync(join(root, '.intent/review-state.json'), 'utf8')).toBe(
    original,
  )
})

it('requires reasons and evidence; unresolved items never suppress future reviews', () => {
  const report = createReview(root)
  report.items[0]!.outcome = 'no-change'
  expect(() => recordReview(root, report)).toThrow(/reason and evidence/)
  report.items[0]!.outcome = 'unresolved'
  expect(recordReview(root, report)).toBe(0)
  expect(createReview(root).items).toHaveLength(1)
})

it('fails closed for corrupt state and symlinked sources or state directories', () => {
  write('.intent/review-state.json', '{"schemaVersion":77}')
  expect(() => createReview(root)).toThrow(/Invalid review state/)
  rmSync(join(root, '.intent'), { recursive: true })
  rmSync(join(root, 'src/request.ts'))
  symlinkSync('/etc/hosts', join(root, 'src/request.ts'))
  expect(createReview(root).items[0]?.problems.join(' ')).toMatch(
    /symbolic link/,
  )
  rmSync(join(root, 'src/request.ts'))
  write('src/request.ts', 'restored\n')
  symlinkSync(tmpdir(), join(root, '.intent'))
  expect(() => accept()).toThrow(/symbolic link/)
})

it('tracks renames as removal and addition and retains deleted skill review', () => {
  accept()
  renameSync(join(root, 'src/request.ts'), join(root, 'src/renamed.ts'))
  expect(createReview(root).items[0]?.changedFiles).toEqual([
    'src/renamed.ts',
    'src/request.ts',
  ])
  rmSync(join(root, 'skills/request'), { recursive: true })
  expect(
    createReview(root).items.some(
      (item) => item.id === 'source:skills/request/SKILL.md',
    ),
  ).toBe(true)
})

it('resolves plain sources relative to their owning monorepo package', () => {
  rmSync(join(root, 'skills'), { recursive: true })
  write(
    'packages/client/skills/task/SKILL.md',
    '---\nname: task\nsources: [src/index.ts]\n---\nTask\n',
  )
  write('packages/client/src/index.ts', 'public API\n')
  const item = createReview(root).items.find((entry) => entry.kind === 'skill')!
  expect(item.problems).toEqual([])
  expect(Object.keys(item.snapshot)).toContain('packages/client/src/index.ts')
})

it('retains review when an acknowledged untracked skill is removed before its first commit', () => {
  write(
    'skills/new/SKILL.md',
    '---\nname: new\nsources: [src/request.ts]\n---\nNew task\n',
  )
  accept()
  rmSync(join(root, 'skills/new'), { recursive: true })
  expect(createReview(root).items.map((item) => item.id)).toEqual([
    'source:skills/new/SKILL.md',
  ])
})

it('returns a failing CLI check until recorded review clears the items', async () => {
  expect(await main(['review', root, '--check'])).toBe(1)
  accept()
  expect(await main(['review', root, '--check'])).toBe(0)
})
