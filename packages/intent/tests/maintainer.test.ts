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
import type { AdoptionPlan } from '../src/maintainer/adopt.js'

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
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
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

it('previews existing library skills without writing or including agent and dependency skills', async () => {
  write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
  write('packages/client/package.json', '{"name":"@library/client"}\n')
  for (const directory of [
    'skills/root-task',
    'packages/client/skills/query',
    '.agents/skills/agent-only',
    '.github/skills/review',
    'node_modules/dependency/skills/dependency',
  ]) {
    const name = directory.split('/').at(-1)
    write(
      `${directory}/SKILL.md`,
      `---\nname: ${name}\ndescription: Use for ${name}.\nsources: [package.json]\n---\nExisting guidance.\n`,
    )
  }
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(plan.skills).toEqual([
    expect.objectContaining({
      name: 'query',
      package: 'packages/client',
      path: 'skills/query/SKILL.md',
      status: 'unregistered',
      selected: false,
    }),
    expect.objectContaining({
      name: 'root-task',
      package: '',
      path: 'skills/root-task/SKILL.md',
      status: 'unregistered',
      selected: false,
    }),
  ])
  expect(existsSync(join(root, '_artifacts'))).toBe(false)
  expect(existsSync(join(root, '.intent'))).toBe(false)
  expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
})

it('excludes nested fixture packages unless their directory is explicitly requested', async () => {
  write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
  for (const directory of ['packages/client', 'tests/fixtures/client']) {
    write(`${directory}/package.json`, '{"name":"client"}\n')
    write(
      `${directory}/skills/query/SKILL.md`,
      '---\nname: query\ndescription: Query\n---\nGuidance.\n',
    )
  }
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(plan.skills.map((skill: { id: string }) => skill.id)).toEqual([
    'packages/client/skills/query/SKILL.md',
  ])
  vi.mocked(console.log).mockClear()
  expect(
    await main([
      'maintainer',
      'adopt',
      '--path',
      'tests/fixtures/client/skills',
      '--json',
    ]),
  ).toBe(0)
  const explicit = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(explicit.skills).toHaveLength(2)
})

it('adopts a confirmed batch without rewriting skills or approving their content', async () => {
  const guidance =
    '---\nname: query\ndescription: Use when querying.\nmetadata:\n  purpose: Preserve this purpose.\nsources: [package.json]\n---\nAuthored guidance.\n'
  write('skills/query/SKILL.md', guidance)
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  plan.skills[0].selected = true
  plan.skills[0].domain = 'queries'
  plan.distribution = { mode: 'none' }
  write('adoption.json', JSON.stringify(plan))
  expect(await main(['maintainer', 'adopt', '--apply', 'adoption.json'])).toBe(
    0,
  )
  expect(read('skills/query/SKILL.md')).toBe(guidance)
  expect(
    parse(read('skills/_artifacts/skill_tree.yaml')).skills[0],
  ).toMatchObject({
    name: 'query',
    domain: 'queries',
    purpose: 'Preserve this purpose.',
  })
  expect(
    parse(read('skills/_artifacts/domain_map.yaml')).skills[0].tasks,
  ).toEqual([])
  expect(read('skills/_artifacts/skill_spec.md')).toContain(
    'intent:needs-authoring',
  )
  expect(read('AGENTS.md')).toContain('maintainer check')
  expect(existsSync(join(root, '.intent/review-state.json'))).toBe(false)
  expect(await main(['maintainer', 'check'])).toBe(1)
  const before = ['skill_tree.yaml', 'domain_map.yaml', 'skill_spec.md'].map(
    (name) => read(`skills/_artifacts/${name}`),
  )
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const repeated = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(repeated.skills[0].status).toBe('registered')
  write('adoption.json', JSON.stringify(repeated))
  expect(await main(['maintainer', 'adopt', '--apply', 'adoption.json'])).toBe(
    0,
  )
  expect(
    ['skill_tree.yaml', 'domain_map.yaml', 'skill_spec.md'].map((name) =>
      read(`skills/_artifacts/${name}`),
    ),
  ).toEqual(before)
})

it('rejects invalid batch choices and stale adoption plans before creating records', async () => {
  for (const name of ['query', 'cache'])
    write(
      `skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: ${name}\n---\nGuidance.\n`,
    )
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  for (const candidate of plan.skills) candidate.selected = true
  plan.skills[0].domain = 'queries'
  write('adoption.json', JSON.stringify(plan))
  expect(await main(['maintainer', 'adopt', '--apply', 'adoption.json'])).toBe(
    1,
  )
  expect(existsSync(join(root, 'skills/_artifacts'))).toBe(false)
  plan.skills[1].domain = 'queries'
  write('adoption.json', JSON.stringify(plan))
  write(
    'skills/query/SKILL.md',
    read('skills/query/SKILL.md') + 'Later change.\n',
  )
  expect(await main(['maintainer', 'adopt', '--apply', 'adoption.json'])).toBe(
    1,
  )
  expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
    'changed',
  )
  expect(existsSync(join(root, 'skills/_artifacts'))).toBe(false)
  expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
})

it('requires interactive confirmation and keeps cancellation read-only', async () => {
  write(
    'skills/query/SKILL.md',
    '---\nname: query\ndescription: Query\n---\nGuidance.\n',
  )
  const choose = vi.fn((plan: AdoptionPlan) => {
    plan.skills[0]!.selected = true
    plan.skills[0]!.domain = 'queries'
    plan.distribution = { mode: 'none' }
    return Promise.resolve(plan)
  })
  const confirm = vi.fn(() => Promise.resolve(false))
  const runtime = {
    isTTY: true,
    isCI: false,
    adoptionPrompts: { choose, confirm },
  }
  expect(await main(['maintainer', 'adopt'], runtime)).toBe(0)
  expect(confirm).toHaveBeenCalledOnce()
  expect(existsSync(join(root, 'skills/_artifacts'))).toBe(false)
  expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  confirm.mockResolvedValue(true)
  expect(await main(['maintainer', 'adopt'], runtime)).toBe(0)
  expect(parse(read('skills/_artifacts/skill_tree.yaml')).skills[0].name).toBe(
    'query',
  )
})

it('requires explicit noninteractive adoption and reports custom-root conflicts', async () => {
  write(
    'guidance/query/SKILL.md',
    '---\nname: query\ndescription: Query\n---\nGuidance.\n',
  )
  expect(await main(['maintainer', 'adopt'], { isTTY: false })).toBe(1)
  expect(existsSync(join(root, '.intent'))).toBe(false)
  vi.mocked(console.log).mockClear()
  expect(
    await main(['maintainer', 'adopt', '--path', 'guidance', '--json']),
  ).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(plan.skills[0].id).toBe('guidance/query/SKILL.md')
  write('skills/query/SKILL.md', read('guidance/query/SKILL.md'))
  vi.mocked(console.log).mockClear()
  expect(
    await main(['maintainer', 'adopt', '--path', 'guidance', '--json']),
  ).toBe(0)
  const conflicts = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(
    conflicts.skills.map((skill: { status: string }) => skill.status),
  ).toEqual(['conflict', 'conflict'])
})

it('never prompts in CI even when a terminal is attached', async () => {
  const choose = vi.fn(() => Promise.resolve(null))
  const confirm = vi.fn(() => Promise.resolve(false))
  const runtime = {
    isTTY: true,
    isCI: true,
    adoptionPrompts: { choose, confirm },
  }
  expect(await main(['maintainer', 'adopt'], runtime)).toBe(1)
  expect(await main(['maintainer', 'adopt', '--json'], runtime)).toBe(0)
  expect(choose).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
  expect(existsSync(join(root, '.intent'))).toBe(false)
  expect(existsSync(join(root, 'skills/_artifacts'))).toBe(false)
})

it('keeps planned and retired entries separate from missing active skills', async () => {
  expect(await main(['maintainer', 'setup'])).toBe(0)
  write(
    'skills/_artifacts/skill_tree.yaml',
    'skills:\n  - name: future\n    path: skills/future/SKILL.md\n    status: planned\n  - name: old\n    path: skills/old/SKILL.md\n    status: retired\n  - name: missing\n    path: skills/missing/SKILL.md\n',
  )
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(plan.skills.map((skill: { status: string }) => skill.status)).toEqual([
    'planned',
    'missing',
    'retired',
  ])
})

it('rejects adoption after repository instructions change', async () => {
  write(
    'skills/query/SKILL.md',
    '---\nname: query\ndescription: Query\n---\nGuidance.\n',
  )
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  plan.skills[0].selected = true
  plan.skills[0].domain = 'queries'
  write('adoption.json', JSON.stringify(plan))
  write('AGENTS.md', 'New maintainer instructions.\n')
  expect(await main(['maintainer', 'adopt', '--apply', 'adoption.json'])).toBe(
    1,
  )
  expect(read('AGENTS.md')).toBe('New maintainer instructions.\n')
  expect(existsSync(join(root, 'skills/_artifacts'))).toBe(false)
})

it('adopts two packages and saves an explicit distribution selection', async () => {
  write(
    'package.json',
    '{"name":"library","repository":"https://github.com/acme/library"}\n',
  )
  write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
  for (const name of ['query', 'cache']) {
    write(`packages/${name}/package.json`, `{"name":"@library/${name}"}\n`)
    write(
      `packages/${name}/skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: Use for ${name}.\nsources: [package.json]\n---\nAuthored ${name} guidance.\n`,
    )
  }
  expect(await main(['maintainer', 'adopt', '--json'])).toBe(0)
  const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  for (const candidate of plan.skills) {
    candidate.selected = true
    candidate.domain = 'queries'
  }
  plan.distribution = {
    mode: 'repo',
    repository: 'acme/library',
    skills: ['query'],
  }
  write('adoption.json', JSON.stringify(plan))
  expect(await main(['maintainer', 'adopt', '--apply', 'adoption.json'])).toBe(
    0,
  )
  const tree = parse(read('_artifacts/skill_tree.yaml'))
  expect(
    tree.skills.map((skill: { package: string }) => skill.package),
  ).toEqual(['packages/cache', 'packages/query'])
  expect(tree.distribution).toEqual({
    mode: 'repo',
    repository: 'acme/library',
    name: 'acme-library',
    skills: ['query'],
  })
  expect(existsSync(join(root, '.claude-plugin'))).toBe(false)
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

it('registers a skill with the workspace package that owns the current directory', async () => {
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write('packages/client/package.json', '{"name":"@library/client"}\n')
  write('packages/client/src/query.ts', 'export const query = () => 1\n')
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
  process.chdir(join(root, 'packages/client'))
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
  expect(existsSync(join(root, 'packages/client/skills/query/SKILL.md'))).toBe(
    true,
  )
  expect(existsSync(join(root, 'skills'))).toBe(false)
  expect(parse(read('_artifacts/skill_tree.yaml')).skills[0]).toMatchObject({
    name: 'query',
    package: 'packages/client',
    path: 'skills/query/SKILL.md',
  })
  expect(
    vi
      .mocked(console.log)
      .mock.calls.flat()
      .some((line) =>
        String(line).includes(
          'Registered packages/client/skills/query/SKILL.md',
        ),
      ),
  ).toBe(true)
  // An explicit --package remains repository-relative from any directory.
  expect(
    await main([
      'maintainer',
      'add',
      'root-only',
      '--package',
      '.',
      '--domain',
      'setup',
      '--description',
      'Use when configuring the workspace.',
      '--source',
      'pnpm-workspace.yaml',
    ]),
  ).toBe(0)
  expect(existsSync(join(root, 'skills/root-only/SKILL.md'))).toBe(true)
})

it('does not ask for a review of the files setup and sync write', async () => {
  write('src/query.ts', 'export const query = () => 1\n')
  write('pnpm-lock.yaml', 'lockfileVersion: 9\n')
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
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
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(
    createReview(root)
      .items.map((item) => item.id)
      .sort(),
  ).toEqual(['planning:skills/_artifacts', 'skill:skills/query/SKILL.md'])
})

it('names written files, labels install commands, and explains unsupported options', async () => {
  const logs = () => vi.mocked(console.log).mock.calls.flat().map(String)
  const errors = () => vi.mocked(console.error).mock.calls.flat().map(String)
  write('src/query.ts', 'export const query = () => 1\n')
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
  vi.mocked(console.log).mockClear()
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
  expect(logs()).toEqual([
    'Registered skills/query/SKILL.md.',
    'Updated: skills/query/SKILL.md, skills/_artifacts/skill_tree.yaml, skills/_artifacts/domain_map.yaml, skills/_artifacts/skill_spec.md',
    expect.stringContaining('skills/_artifacts/domain_map.yaml'),
  ])
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(logs()[0]).toBe('Synchronized package.json')
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(logs()[0]).toBe('Nothing to synchronize.')
  expect(await main(['maintainer', 'sync', '--plugin-name', 'x'])).toBe(1)
  expect(errors().at(-1)).toBe(
    '--plugin-name is not supported by maintainer sync. Run intent maintainer sync --help for its options.',
  )
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'status'])).toBe(0)
  expect(logs()).toContain(
    '  Review skill skills/query/SKILL.md: changed skills/query/SKILL.md, src/query.ts',
  )
  expect(logs()).toContain(
    '  Review planning records skills/_artifacts: changed skills/_artifacts/domain_map.yaml, skills/_artifacts/skill_spec.md, skills/_artifacts/skill_tree.yaml, skills/query/SKILL.md, src/query.ts',
  )
})

it('reports every missing repository distribution input at once', async () => {
  expect(await main(['maintainer', 'setup', '--distribution', 'repo'])).toBe(1)
  expect(vi.mocked(console.error).mock.calls.flat().map(String).at(-1)).toBe(
    'Repository distribution needs: a GitHub repository with --repository <owner/repo>; a kebab-case name with --plugin-name <name>; the public skills with --skill <name> (repeat for multiple skills).',
  )
})

it('validates each skills root once during check', async () => {
  write('src/query.ts', 'export const query = () => 1\n')
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
  for (const name of ['one', 'two']) {
    write(
      `skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: Use ${name}.\nsources: [src/query.ts]\n---\nGuidance.\n`,
    )
    expect(await main(['maintainer', 'add', name, '--domain', 'queries'])).toBe(
      0,
    )
  }
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'check'])).toBe(1)
  expect(
    vi
      .mocked(console.log)
      .mock.calls.flat()
      .map(String)
      .filter((line) => line.includes('Validated 2 skill files')),
  ).toHaveLength(1)
})

it('records developer tasks at registration and retires a skill without deleting it', async () => {
  const logs = () => vi.mocked(console.log).mock.calls.flat().map(String)
  const errors = () => vi.mocked(console.error).mock.calls.flat().map(String)
  write('src/query.ts', 'export const query = () => 1\n')
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
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
      '--task',
      'Read the current value',
      '--task',
      'Subscribe to changes',
    ]),
  ).toBe(0)
  expect(
    parse(read('skills/_artifacts/domain_map.yaml')).skills[0].tasks,
  ).toEqual(['Read the current value', 'Subscribe to changes'])
  expect(read('skills/_artifacts/skill_spec.md')).toContain(
    'Developer tasks: Read the current value; Subscribe to changes.',
  )
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'status'])).toBe(0)
  expect(logs().join('\n')).not.toContain('record the assessed developer tasks')

  expect(
    await main([
      'maintainer',
      'add',
      'dependent',
      '--domain',
      'queries',
      '--description',
      'Use after query.',
      '--source',
      'src/query.ts',
      '--requires',
      'query',
    ]),
  ).toBe(0)
  expect(await main(['maintainer', 'remove', 'query'])).toBe(1)
  expect(errors().at(-1)).toContain('is required by dependent')
  expect(await main(['maintainer', 'remove', 'missing'])).toBe(1)
  expect(errors().at(-1)).toBe('Skill missing is not registered.')

  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'remove', 'dependent'])).toBe(0)
  expect(logs()).toEqual([
    'Retired dependent.',
    'Updated: skills/_artifacts/skill_tree.yaml, skills/_artifacts/skill_spec.md',
    expect.stringContaining('Delete skills/dependent/SKILL.md'),
  ])
  const tree = parse(read('skills/_artifacts/skill_tree.yaml'))
  expect(tree.skills[1]).toMatchObject({ name: 'dependent', status: 'retired' })
  expect(existsSync(join(root, 'skills/dependent/SKILL.md'))).toBe(true)
  expect(read('skills/_artifacts/skill_spec.md')).toContain(
    'Retired `dependent`',
  )
  expect(await main(['maintainer', 'remove', 'dependent'])).toBe(1)
  expect(errors().at(-1)).toBe('Skill dependent is already retired.')
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(JSON.parse(read('package.json')).files).toBeUndefined()
})

it('refuses to retire a skill selected for repository distribution', async () => {
  write('src/query.ts', 'export const query = () => 1\n')
  write(
    'package.json',
    '{"name":"library","version":"1.0.0","repository":"https://github.com/acme/library"}\n',
  )
  expect(await main(['maintainer', 'setup'])).toBe(0)
  write(
    'skills/query/SKILL.md',
    '---\nname: query\ndescription: Use when querying with Library.\nsources: [src/query.ts]\n---\nCall query().\n',
  )
  expect(
    await main(['maintainer', 'add', 'query', '--domain', 'queries']),
  ).toBe(0)
  expect(
    await main([
      'maintainer',
      'setup',
      '--distribution',
      'repo',
      '--skill',
      'query',
    ]),
  ).toBe(0)
  expect(await main(['maintainer', 'remove', 'query'])).toBe(1)
  expect(
    vi.mocked(console.error).mock.calls.flat().map(String).at(-1),
  ).toContain('selected for repository distribution')
  expect(
    parse(read('skills/_artifacts/skill_tree.yaml')).skills[0].status,
  ).toBeUndefined()
})
