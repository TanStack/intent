import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parse, parseDocument, stringify } from 'yaml'
import { main } from '../src/cli.js'
import type * as Yaml from 'yaml'

vi.mock('yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof Yaml>()
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) }
})

let root: string
let previousCwd: string
function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
function read(path: string) {
  return readFileSync(join(root, path), 'utf8')
}
function readJson(path: string) {
  return JSON.parse(read(path))
}

beforeEach(async () => {
  previousCwd = process.cwd()
  root = mkdtempSync(join(tmpdir(), 'intent-distribution-'))
  process.chdir(root)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
    cwd: root,
  })
  write(
    'package.json',
    '{"name":"library","repository":"https://github.com/acme/library"}\n',
  )
  write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
  write(
    'packages/client/package.json',
    '{"name":"@acme/client","files":["dist"]}\n',
  )
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'add', '.'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: root },
  )
  expect(await main(['maintainer', 'setup'])).toBe(0)
  for (const name of ['query', 'internal']) {
    write(
      `packages/client/skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: Use for the ${name} task.\nsources: [package.json]\n---\nRun the ${name} task.\n`,
    )
    expect(
      await main([
        'maintainer',
        'add',
        name,
        '--package',
        'packages/client',
        '--domain',
        'queries',
      ]),
    ).toBe(0)
  }
})
afterEach(() => {
  process.chdir(previousCwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('plans selected distribution from one parsed skill tree', async () => {
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
  const tree = read('_artifacts/skill_tree.yaml')
  vi.mocked(parseDocument).mockClear()

  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(
    vi.mocked(parseDocument).mock.calls.filter(([source]) => source === tree),
  ).toHaveLength(1)
  expect(readJson('.claude-plugin/plugin.json').skills).toEqual([
    './packages/client/skills/query',
  ])
})

it('explains the missing choice, remembers an opt-out, and does not ask again', async () => {
  expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
    '--distribution',
  )
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
  expect(parse(read('_artifacts/skill_tree.yaml')).distribution).toEqual({
    mode: 'none',
  })
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'setup'])).toBe(0)
  expect(vi.mocked(console.log).mock.calls.flat().join('\n')).not.toContain(
    'Choose',
  )
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(existsSync(join(root, '.claude-plugin'))).toBe(false)
})

it('generates selected package paths, preserves plugin fields, and leaves skill contents in place', async () => {
  const original = read('packages/client/skills/query/SKILL.md')
  write(
    '.claude-plugin/plugin.json',
    '{\n  "name": "acme-library",\n  "description": "Our existing plugin",\n  "commands": ["./commands/custom.md"]\n}\n',
  )
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
  expect(await main(['maintainer', 'sync'])).toBe(0)
  const plugin = readJson('.claude-plugin/plugin.json')
  expect(plugin.skills).toEqual(['./packages/client/skills/query'])
  expect(plugin.commands).toEqual(['./commands/custom.md'])
  expect(plugin.description).toBe('Our existing plugin')
  expect(readJson('.cursor-plugin/plugin.json').skills).toEqual(plugin.skills)
  expect(readJson('.claude-plugin/marketplace.json').plugins[0].skills).toEqual(
    plugin.skills,
  )
  const instructions = readJson('.intent/skill-distribution.json')
  expect(instructions.install.skills).toEqual([
    'npx',
    'skills',
    'add',
    'acme/library',
    '--full-depth',
    '--skill',
    'query',
  ])
  expect(instructions.install.github).toEqual([
    [
      'gh',
      'skill',
      'add',
      'acme/library',
      'packages/client/skills/query/SKILL.md',
    ],
  ])
  expect(read('packages/client/skills/query/SKILL.md')).toBe(original)
  expect(existsSync(join(root, 'skills/query/SKILL.md'))).toBe(false)
  const files = [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.cursor-plugin/plugin.json',
    '.cursor-plugin/marketplace.json',
    '.intent/skill-distribution.json',
    '_artifacts/skill_tree.yaml',
  ]
  const before = files.map(read)
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(files.map(read)).toEqual(before)
  const tree = parse(read('_artifacts/skill_tree.yaml'))
  tree.skills.push({
    name: 'future',
    slug: 'future',
    path: 'skills/future/SKILL.md',
    status: 'planned',
  })
  write('_artifacts/skill_tree.yaml', stringify(tree))
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(readJson('.claude-plugin/plugin.json').skills).toEqual(plugin.skills)
  write(
    'packages/client/skills/more/SKILL.md',
    '---\nname: more\ndescription: Another task\nsources: [package.json]\n---\nAnother task.\n',
  )
  expect(
    await main([
      'maintainer',
      'add',
      'more',
      '--package',
      'packages/client',
      '--domain',
      'queries',
    ]),
  ).toBe(0)
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(readJson('.claude-plugin/plugin.json').skills).toEqual(plugin.skills)
}, 30_000)

it('reports stale exports and removes its selected paths on opt-out while retaining other plugin features', async () => {
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
  expect(await main(['maintainer', 'sync'])).toBe(0)
  const plugin = readJson('.claude-plugin/plugin.json')
  plugin.skills = ['./packages/client/skills/internal']
  plugin.commands = ['./commands/retained.md']
  write('.claude-plugin/plugin.json', JSON.stringify(plugin))
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'status', '--json'])).toBe(0)
  const status = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(status.staleFiles).toContain('.claude-plugin/plugin.json')
  expect(await main(['maintainer', 'setup', '--distribution', 'none'])).toBe(0)
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(readJson('.claude-plugin/plugin.json').skills).toEqual([])
  expect(readJson('.claude-plugin/plugin.json').commands).toEqual(
    plugin.commands,
  )
  expect(readJson('.claude-plugin/marketplace.json').plugins).toEqual([])
  expect(readJson('.intent/skill-distribution.json').install.skills).toEqual([])
  expect(read('packages/client/skills/query/SKILL.md')).toContain(
    'Run the query task.',
  )
}, 30_000)

it('requires prerequisites to be selected and refuses foreign plugin ownership before any sync writes', async () => {
  write(
    'packages/client/skills/query/SKILL.md',
    '---\nname: query\ndescription: Query\nsources: [package.json]\nrequires: [internal]\n---\nRead internal before querying.\n',
  )
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
  const manifest = read('packages/client/package.json')
  expect(await main(['maintainer', 'sync'])).toBe(1)
  expect(read('packages/client/package.json')).toBe(manifest)
  expect(existsSync(join(root, '.claude-plugin'))).toBe(false)
  expect(
    await main([
      'maintainer',
      'setup',
      '--distribution',
      'repo',
      '--skill',
      'query',
      '--skill',
      'internal',
    ]),
  ).toBe(0)
  write('.cursor-plugin/plugin.json', '{"name":"another-plugin","skills":[]}\n')
  expect(await main(['maintainer', 'sync'])).toBe(1)
  expect(read('packages/client/package.json')).toBe(manifest)
  expect(existsSync(join(root, '.claude-plugin'))).toBe(false)
})

it('refuses a conflicting Claude marketplace definition before any sync writes', async () => {
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
  const marketplace = {
    name: 'acme-marketplace',
    owner: { name: 'acme' },
    plugins: [
      {
        name: 'acme-library',
        source: './',
        strict: false,
        description: 'Keep this description',
      },
    ],
  }
  write('.claude-plugin/marketplace.json', JSON.stringify(marketplace))
  const manifest = read('packages/client/package.json')
  const tree = read('_artifacts/skill_tree.yaml')
  expect(await main(['maintainer', 'sync'])).toBe(1)
  expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
    'strict: false',
  )
  expect(read('packages/client/package.json')).toBe(manifest)
  expect(read('_artifacts/skill_tree.yaml')).toBe(tree)
  expect(readJson('.claude-plugin/marketplace.json')).toEqual(marketplace)
  expect(existsSync(join(root, '.claude-plugin/plugin.json'))).toBe(false)
  expect(existsSync(join(root, '.cursor-plugin'))).toBe(false)
  expect(existsSync(join(root, '.intent/skill-distribution.json'))).toBe(false)

  marketplace.plugins[0]!.strict = true
  write('.claude-plugin/marketplace.json', JSON.stringify(marketplace))
  expect(await main(['maintainer', 'sync'])).toBe(0)
  expect(readJson('.claude-plugin/marketplace.json').plugins).toEqual([
    {
      ...marketplace.plugins[0],
      skills: ['./packages/client/skills/query'],
    },
  ])
})

it.each(['.claude-plugin', '.cursor-plugin'])(
  'refuses a prefixed %s marketplace source before any sync writes',
  async (directory) => {
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
    const marketplace = {
      name: 'acme-marketplace',
      owner: { name: 'acme' },
      metadata: { pluginRoot: './plugins', description: 'Keep this metadata' },
      plugins: [{ name: 'other', source: './other' }],
    }
    const path = `${directory}/marketplace.json`
    write(path, JSON.stringify(marketplace))
    const manifest = read('packages/client/package.json')
    expect(await main(['maintainer', 'sync'])).toBe(1)
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
      'pluginRoot',
    )
    expect(read('packages/client/package.json')).toBe(manifest)
    expect(readJson(path)).toEqual(marketplace)
    expect(existsSync(join(root, '.claude-plugin/plugin.json'))).toBe(false)
    expect(existsSync(join(root, '.cursor-plugin/plugin.json'))).toBe(false)

    marketplace.metadata.pluginRoot = './'
    write(path, JSON.stringify(marketplace))
    expect(await main(['maintainer', 'sync'])).toBe(0)
    expect(readJson(path).metadata).toEqual(marketplace.metadata)
    expect(readJson(path).plugins).toEqual([
      ...marketplace.plugins,
      {
        name: 'acme-library',
        source: './',
        skills: ['./packages/client/skills/query'],
      },
    ])
  },
  30_000,
)
