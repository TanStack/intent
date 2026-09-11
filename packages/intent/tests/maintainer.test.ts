import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { main } from '../src/cli.js'
import { createReview } from '../src/review/review.js'

let root: string
let previousCwd: string

function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function read(path: string) {
  return readFileSync(join(root, path), 'utf8')
}

beforeEach(() => {
  previousCwd = process.cwd()
  root = mkdtempSync(join(tmpdir(), 'intent-maintainer-'))
  process.chdir(root)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
    cwd: root,
  })
  write('package.json', '{"name":"library","version":"1.0.0"}\n')
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'add', '.'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-qm',
      'Initial',
    ],
    { cwd: root },
  )
})

it('checks the authored workflow, rejects stale outcomes, and reopens after source edits', async () => {
  write('src/query.ts', 'export const query = () => 1\n')
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(
    await main([
      'maintainer',
      'add',
      'query',
      '--domain',
      'queries',
      '--description',
      'Use when querying with Library.',
      '--source',
      'src/query.ts',
    ]),
  ).toBe(0)
  write(
    'skills/query/SKILL.md',
    '---\nname: query\ndescription: Use when querying with Library.\nsources: [src/query.ts]\n---\nCall query() to obtain the current value.\n',
  )
  write(
    'skills/_artifacts/domain_map.yaml',
    'domains: [{slug: queries, name: Queries}]\nskills:\n  - slug: query\n    domain: queries\n    tasks: [Read the current value]\n',
  )
  write(
    'skills/_artifacts/skill_spec.md',
    '# Skill spec\n\n## Coverage and batch history\n\nThe query task covers src/query.ts; future mutation guidance remains unassessed. Checked query() returns 1.\n',
  )
  expect(await main(['maintainer', 'sync'])).toBe(0)
  const report = createReview(root)
  for (const item of report.items) {
    item.outcome = 'updated'
    item.reason =
      'Checked the query example against the implementation and reconciled all three planning records.'
    item.evidence = [
      'src/query.ts returns 1; the fixture checks the corresponding consumer instruction.',
    ]
  }
  write('.intent/review.json', JSON.stringify(report))
  expect(
    await main(['maintainer', 'review', '--record', '.intent/review.json']),
  ).toBe(0)
  expect(await main(['maintainer', 'check'])).toBe(0)
  write('src/query.ts', 'export const query = () => 2\n')
  expect(await main(['maintainer', 'check'])).toBe(1)
  expect(
    await main(['maintainer', 'review', '--record', '.intent/review.json']),
  ).toBe(1)
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'status', '--json'])).toBe(0)
  const status = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(
    status.review.items.map((item: { kind: string }) => item.kind),
  ).toEqual(expect.arrayContaining(['skill', 'planning']))
}, 30_000)

it('uses a custom shared record from a nested package and rejects malformed companions before writing', async () => {
  write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
  write('packages/client/package.json', '{"name":"client"}\n')
  write('planning/domain_map.yaml', '# Keep these decisions\nskills: []\n')
  process.chdir(join(root, 'packages/client'))
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(read('planning/domain_map.yaml')).toBe(
    '# Keep these decisions\nskills: []\n',
  )
  expect(
    parse(read('planning/skill_tree.yaml')).generated_from.domain_map,
  ).toBe('planning/domain_map.yaml')
  write('planning/skill_tree.yaml', 'skills: [\n')
  const before = read('planning/domain_map.yaml')
  expect(
    await main(['maintainer', 'add', 'query', '--domain', 'queries']),
  ).toBe(1)
  expect(read('planning/domain_map.yaml')).toBe(before)
})

it('does not narrow npm default contents or write for invalid command options', async () => {
  expect(await main(['maintainer', 'setup', '--record', 'report.json'])).toBe(1)
  expect(await main(['maintainer', 'setup'])).toBe(0)
  write(
    'skills/existing/SKILL.md',
    '---\nname: existing\ndescription: Existing guidance\nsources: [package.json]\n---\nRead the package name.\n',
  )
  expect(
    await main(['maintainer', 'add', 'existing', '--domain', 'setup']),
  ).toBe(0)
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(JSON.parse(read('package.json')).files).toBeUndefined()
  write('.intent/maintainer.lock', 'Other process\n')
  expect(await main(['maintainer', 'sync'])).toBe(1)
  expect(read('.intent/maintainer.lock')).toBe('Other process\n')
})

it('rejects paths outside the repository and symlinked directories before changing the records', async () => {
  expect(await main(['maintainer', 'setup'])).toBe(0)
  const tree = read('skills/_artifacts/skill_tree.yaml')
  const outside = mkdtempSync(join(tmpdir(), 'intent-maintainer-outside-'))
  try {
    symlinkSync(outside, join(root, 'linked'))
    for (const path of [
      '../query/SKILL.md',
      'linked/query/SKILL.md',
      '.git/query/SKILL.md',
    ]) {
      expect(
        await main([
          'maintainer',
          'add',
          'query',
          '--domain',
          'queries',
          '--path',
          path,
          '--description',
          'Query',
          '--source',
          'package.json',
        ]),
      ).toBe(1)
      expect(read('skills/_artifacts/skill_tree.yaml')).toBe(tree)
    }
    expect(existsSync(join(outside, 'query'))).toBe(false)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

it('rejects cyclic prerequisites without applying an otherwise valid package update', async () => {
  expect(await main(['maintainer', 'setup'])).toBe(0)
  for (const [name, dependency] of [
    ['query', 'cache'],
    ['cache', 'query'],
  ]) {
    expect(
      await main([
        'maintainer',
        'add',
        name!,
        '--domain',
        'queries',
        '--description',
        'Query',
        '--source',
        'package.json',
        '--requires',
        dependency!,
      ]),
    ).toBe(0)
  }
  const manifest = read('package.json')
  const tree = read('skills/_artifacts/skill_tree.yaml')
  expect(await main(['maintainer', 'sync'])).toBe(1)
  expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
    'Cyclic skill prerequisite',
  )
  expect(read('package.json')).toBe(manifest)
  expect(read('skills/_artifacts/skill_tree.yaml')).toBe(tree)
})

it('preserves a planning record located directly at the repository root', async () => {
  write('domain_map.yaml', '# Prior scope\nskills: []\n')
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(read('domain_map.yaml')).toBe('# Prior scope\nskills: []\n')
  expect(parse(read('skill_tree.yaml')).generated_from.domain_map).toBe(
    'domain_map.yaml',
  )
})

afterEach(() => {
  process.chdir(previousCwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('sets up one cumulative record, preserves authored content, and keeps unfinished setup visible', async () => {
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(read('AGENTS.md')).toContain('maintainer check')
  expect(parse(read('skills/_artifacts/skill_tree.yaml')).skills).toEqual([])
  expect(await main(['maintainer', 'check'])).toBe(1)
  const original =
    read('skills/_artifacts/skill_spec.md') +
    '\nKeep this maintainer decision.\n'
  write('skills/_artifacts/skill_spec.md', original)
  const tree = read('skills/_artifacts/skill_tree.yaml')
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(read('skills/_artifacts/skill_spec.md')).toBe(original)
  expect(read('skills/_artifacts/skill_tree.yaml')).toBe(tree)
})

it('registers a package-owned skill and synchronizes metadata without replacing decisions', async () => {
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write(
    'packages/client/package.json',
    '{\n  "name": "@library/client",\n  "version": "1.0.0",\n  "files": ["dist"],\n  "scripts": {"build": "tsc"}\n}\n',
  )
  write('packages/client/src/query.ts', 'export const query = () => 1\n')
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(
    await main([
      'maintainer',
      'add',
      'query',
      '--package',
      'packages/client',
      '--domain',
      'queries',
      '--description',
      'Use when querying with Library.',
      '--source',
      'src/query.ts',
    ]),
  ).toBe(0)
  const skill = 'packages/client/skills/query/SKILL.md'
  const tree = parse(read('_artifacts/skill_tree.yaml'))
  expect(tree.skills[0]).toMatchObject({
    name: 'query',
    package: 'packages/client',
    path: 'skills/query/SKILL.md',
    sources: ['src/query.ts'],
  })
  expect(parse(read('_artifacts/domain_map.yaml')).skills[0].slug).toBe('query')
  expect(await main(['maintainer', 'check'])).toBe(1)
  const existing = read(skill)
  expect(
    await main([
      'maintainer',
      'add',
      'query',
      '--package',
      'packages/client',
      '--domain',
      'queries',
    ]),
  ).toBe(1)
  expect(read(skill)).toBe(existing)
  write(
    skill,
    existing.replace(
      'Use when querying with Library.',
      'Use when caching Library queries.',
    ),
  )
  write(
    '_artifacts/skill_spec.md',
    read('_artifacts/skill_spec.md') +
      '\nDecision: retain the synchronous query interface.\n',
  )
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(parse(read('_artifacts/skill_tree.yaml')).skills[0].description).toBe(
    'Use when caching Library queries.',
  )
  expect(read('_artifacts/skill_spec.md')).toContain(
    'Decision: retain the synchronous query interface.',
  )
  const manifest = JSON.parse(read('packages/client/package.json'))
  expect(manifest.files).toEqual(['dist', 'skills/query'])
  expect(manifest.scripts).toEqual({ build: 'tsc' })
  const snapshot = [
    skill,
    '_artifacts/skill_tree.yaml',
    '_artifacts/domain_map.yaml',
    '_artifacts/skill_spec.md',
    'packages/client/package.json',
  ].map((path) => [path, read(path)] as const)
  expect(await main(['maintainer', 'sync'])).toBe(0)
  for (const [path, content] of snapshot) expect(read(path)).toBe(content)
})
