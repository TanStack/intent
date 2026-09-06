import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'
import { createReview, recordReview } from '../src/review/review.js'
import type * as NodeFs from 'node:fs'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

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

it('holds the recording lock until the replacement state is published', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const lock = join(root, '.intent/review-state.json.lock')
  let competingWriterBlocked = false
  vi.mocked(renameSync).mockImplementationOnce((from, to) => {
    actual.renameSync(from, to)
    try {
      writeFileSync(lock, 'competing writer', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      competingWriterBlocked = true
    }
  })
  accept()
  expect(competingWriterBlocked).toBe(true)
  expect(actual.existsSync(lock)).toBe(false)
  expect(createReview(root).items).toEqual([])
})

it('explains an existing recording lock without deleting another writer’s lock', () => {
  write('.intent/review-state.json.lock', 'another writer')
  expect(() => accept()).toThrow(/recording.*review-state\.json\.lock/)
  expect(
    readFileSync(join(root, '.intent/review-state.json.lock'), 'utf8'),
  ).toBe('another writer')
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

it('durably adopts an explicit clean baseline after the recorded commit is squashed away', async () => {
  git('branch', '-M', 'main')
  git('switch', '-qc', 'feature')
  write('src/request.ts', 'export const attempts = 4\n')
  git('add', 'src/request.ts')
  git('commit', '-qm', 'feature')
  const reviewedHead = git('rev-parse', 'HEAD')
  accept()
  git('add', '.intent/review-state.json')
  git('commit', '-qm', 'record review')
  git('switch', '-q', 'main')
  git('merge', '--squash', 'feature')
  git('commit', '-qm', 'squashed feature')
  git('branch', '-D', 'feature')
  git('reflog', 'expire', '--expire=now', '--all')
  git('gc', '--prune=now')

  const checkout = join(root, 'rewritten')
  git(
    'clone',
    '--single-branch',
    '--branch',
    'main',
    '--no-local',
    '.',
    checkout,
  )
  expect(() =>
    execFileSync('git', ['cat-file', '-e', `${reviewedHead}^{commit}`], {
      cwd: checkout,
      stdio: 'ignore',
    }),
  ).toThrow()
  expect(() => createReview(checkout)).toThrow(/Cannot resolve review base/)
  const recovery = createReview(checkout, 'HEAD')
  expect(recovery.items).toEqual([])
  expect(recordReview(checkout, recovery)).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(checkout, '.intent/review-state.json'), 'utf8'),
    ).baseline,
  ).toBe(recovery.base)
  expect(createReview(checkout).items).toEqual([])
  expect(await main(['review', checkout, '--check'])).toBe(0)

  const earlier = createReview(checkout, 'HEAD^')
  expect(earlier.items).toEqual([])
  expect(recordReview(checkout, earlier)).toBe(0)
  expect(
    JSON.parse(
      readFileSync(join(checkout, '.intent/review-state.json'), 'utf8'),
    ).baseline,
  ).toBe(recovery.base)
})

it('does not adopt an explicit baseline while review items remain unresolved', () => {
  accept()
  const path = join(root, '.intent/review-state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.baseline = '1111111111111111111111111111111111111111'
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
  write('uncovered.ts', 'unreviewed source\n')

  const recovery = createReview(root, 'HEAD')
  expect(recovery.items.map((item) => item.id)).toEqual(['source:uncovered.ts'])
  expect(recordReview(root, recovery)).toBe(0)
  expect(JSON.parse(readFileSync(path, 'utf8')).baseline).toBe(
    '1111111111111111111111111111111111111111',
  )
  expect(() => createReview(root)).toThrow(/Cannot resolve review base/)
})

it('keeps reviewed deletion fingerprints stable across comparison bases', () => {
  rmSync(join(root, 'src/request.ts'))
  write('src/a.ts', 'export const a = true\n')
  write('src/b.ts', 'export const b = true\n')
  skill(['acme/library:src/**/*.ts'])
  git('add', '-A')
  git('commit', '-qm', 'two sources')
  accept()

  rmSync(join(root, 'src/a.ts'))
  accept()
  git('add', '-A')
  git('commit', '-qm', 'record source deletion')
  const afterDeletion = git('rev-parse', 'HEAD')

  expect(createReview(root).items).toEqual([])
  expect(createReview(root, afterDeletion).items).toEqual([])

  write('src/b.ts', 'export const b = false\n')
  accept(createReview(root, afterDeletion))
  expect(createReview(root).items).toEqual([])
})

it('accepts schema-version-one fingerprints that include reviewed null paths', () => {
  skill(['acme/library:src/**/*.ts'])
  accept()
  const path = join(root, '.intent/review-state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  const id = 'skill:skills/request/SKILL.md'
  state.items[id].snapshot['src/deleted.ts'] = null
  state.items[id].fingerprint = createHash('sha256')
    .update(JSON.stringify([id, state.items[id].snapshot, []]))
    .digest('hex')
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)

  expect(createReview(root, 'HEAD').items).toEqual([])
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

function planningRecords(dir = 'skills/_artifacts') {
  write(
    `${dir}/domain_map.yaml`,
    'library: { name: library }\ndomains: []\nskills: []\n',
  )
  write(
    `${dir}/skill_spec.md`,
    '# Library skills\n\nRequest tasks and maintainer decisions.\n',
  )
  write(`${dir}/skill_tree.yaml`, 'library: { name: library }\nskills: []\n')
}

it('does not adopt an explicit baseline with source or planning problems', () => {
  planningRecords()
  accept()
  const path = join(root, '.intent/review-state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.baseline = '2222222222222222222222222222222222222222'
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
  skill(['src/missing.ts'])
  rmSync(join(root, 'skills/_artifacts/skill_spec.md'))

  const recovery = createReview(root, 'HEAD')
  expect(
    recovery.items
      .filter((item) => item.problems.length > 0)
      .map((item) => item.kind),
  ).toEqual(['skill', 'planning'])
  expect(recordReview(root, recovery)).toBe(0)
  expect(JSON.parse(readFileSync(path, 'utf8')).baseline).toBe(
    '2222222222222222222222222222222222222222',
  )
})

it('requires all three planning records in the installed maintainer workflow', () => {
  write(
    'AGENTS.md',
    '<!-- intent-maintainer:start -->\nMaintain skills.\n<!-- intent-maintainer:end -->\n',
  )
  const report = createReview(root)
  const planning = report.items.find((item) => item.kind === 'planning')
  expect(planning?.path).toBe('skills/_artifacts')
  expect(planning?.problems).toHaveLength(3)
  expect(() => accept()).toThrow(/unresolved planning records/)
  planningRecords()
  accept()
  expect(createReview(root).items).toEqual([])
})

it('reopens planning review for another batch and source edits without reopening unchanged skills', () => {
  planningRecords()
  accept()
  write(
    'skills/pages/SKILL.md',
    '---\nname: pages\nsources: [src/request.ts]\n---\nRead all pages.\n',
  )
  let report = createReview(root)
  expect(report.items.map((item) => item.kind)).toEqual(['skill', 'planning'])
  const planning = report.items.find((item) => item.kind === 'planning')!
  expect(planning.changedFiles).toContain('skills/pages/SKILL.md')
  write(
    'skills/_artifacts/skill_spec.md',
    '# Library skills\n\nRequests and pagination; preserve existing decisions.\n',
  )
  expect(() => accept(report)).toThrow(/changed since this report/)
  accept()
  write('src/request.ts', 'export const attempts = 4\n')
  report = createReview(root)
  expect(
    report.items.filter((item) => item.kind === 'planning')[0]?.changedFiles,
  ).toEqual(['src/request.ts'])
  accept()
  expect(createReview(root).items).toEqual([])
})

it('keeps missing, empty and invalid planning records unresolved after an earlier review', () => {
  planningRecords()
  accept()
  rmSync(join(root, 'skills/_artifacts/skill_spec.md'))
  write('skills/_artifacts/domain_map.yaml', 'library: [')
  write('skills/_artifacts/skill_tree.yaml', '  \n')
  const planning = createReview(root).items.find(
    (item) => item.kind === 'planning',
  )
  expect(planning?.problems).toHaveLength(3)
  expect(() => accept()).toThrow(/unresolved planning records/)
  rmSync(join(root, 'skills/_artifacts'), { recursive: true })
  expect(
    createReview(root).items.find((item) => item.kind === 'planning')?.problems,
  ).toHaveLength(3)
})

it('keeps one shared planning record at the monorepo root', () => {
  write('package.json', '{"name":"library","workspaces":["packages/*"]}\n')
  write(
    'CLAUDE.md',
    '<!-- intent-maintainer:start -->\nMaintain skills.\n<!-- intent-maintainer:end -->\n',
  )
  write(
    'packages/client/skills/request/SKILL.md',
    '---\nname: request\nsources: [src/request.ts]\n---\nClient task.\n',
  )
  write('packages/client/src/request.ts', 'export const attempts = 3\n')
  skill(['src/request.ts'])
  expect(
    createReview(root).items.find((item) => item.kind === 'planning')?.path,
  ).toBe('_artifacts')
  planningRecords('_artifacts')
  accept()
  expect(createReview(root).items).toEqual([])
  expect(
    readFileSync(join(root, '_artifacts/skill_spec.md'), 'utf8'),
  ).toContain('maintainer decisions')
})

it('requires a substantive planning outcome instead of excluding the shared record', () => {
  planningRecords()
  const report = createReview(root)
  const planning = report.items.find((item) => item.kind === 'planning')!
  planning.outcome = 'out-of-scope'
  planning.reason = 'Skip the planning documents.'
  planning.evidence = ['skills/_artifacts']
  expect(() => recordReview(root, report)).toThrow(
    /Planning records require updated or no-change/,
  )
})

it('reopens planning review for removed skills and rejects ignored records', () => {
  planningRecords()
  accept()
  rmSync(join(root, 'skills/request/SKILL.md'))
  expect(
    createReview(root).items.find((item) => item.kind === 'planning')
      ?.changedFiles,
  ).toContain('skills/request/SKILL.md')
  write('.gitignore', 'skills/_artifacts/skill_spec.md\n')
  expect(
    createReview(root)
      .items.find((item) => item.kind === 'planning')
      ?.problems.join(' '),
  ).toContain('must be visible to Git')
})
