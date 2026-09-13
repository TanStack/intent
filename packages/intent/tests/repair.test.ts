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
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { main } from '../src/cli.js'
import { planExampleRepairs } from '../src/validate/blocks.js'

let root: string
let previousCwd: string

function write(file: string, content: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content)
}

beforeEach(() => {
  previousCwd = process.cwd()
  root = mkdtempSync(join(tmpdir(), 'intent-repair-'))
  process.chdir(root)
  write('package.json', '{"name":"@acme/client","version":"1.0.0"}\n')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(previousCwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('repairs frontmatter without rewriting or fully validating code examples', async () => {
  const body =
    '\nUse the client.\n\n```ts\nconst = intentionallyIncomplete\n```\n'
  write(
    'skills/client/SKILL.md',
    `---\nname: client\ndescription: Use the client.\nlibrary: "@acme/client"\n---\n${body}`,
  )

  expect(await main(['repair', '--write', '--json'])).toBe(0)

  const result = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])
  expect(result.repairs).toEqual([
    {
      file: 'skills/client/SKILL.md',
      changes: ['move top-level "library" under metadata.library'],
    },
  ])
  expect(result.problems).toEqual([])
  const repaired = readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')
  const match = repaired.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)!
  expect(parse(match[1]!)).toEqual({
    name: 'client',
    description: 'Use the client.',
    metadata: { library: '@acme/client' },
  })
  expect(match[2]).toBe(body)
})

it('keeps long frontmatter values on one line when repairing', async () => {
  const description =
    'Use when the client needs a long activation sentence that runs well past the default eighty-column YAML fold width.'
  write(
    'skills/client/SKILL.md',
    `---\nname: client\ndescription: ${description}\nlibrary: "@acme/client"\n---\nBody\n`,
  )

  expect(await main(['repair', '--write', '--json'])).toBe(0)

  const repaired = readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')
  expect(repaired).toContain(`\ndescription: ${description}\n`)
  expect(parse(repaired.split('---')[1]!)).toEqual({
    name: 'client',
    description,
    metadata: { library: '@acme/client' },
  })
})

it('prints an applicable patch for labeled alternatives without applying the suggestion', async () => {
  const file = 'skills/client/SKILL.md'
  const before = '// BEFORE (classic)\nfunction Client() { return 1 }\n\n'
  const after = '// AFTER (new)\nfunction Client() { return 2 }\n'
  const source = `---\nname: client\ndescription: Use the client.\n---\n\n\`\`\`tsx title="Client.tsx"\n${before}${after}\`\`\`\n`
  write(file, source)
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)

  expect(await main(['repair', '--patch'])).toBe(0)
  const patch = stdout.mock.calls.map((call) => String(call[0])).join('')
  expect(readFileSync(join(root, file), 'utf8')).toBe(source)
  const applied = spawnSync(
    'git',
    ['-c', 'core.fsmonitor=false', 'apply', '-'],
    { cwd: root, input: patch, encoding: 'utf8' },
  )
  expect(applied.status, applied.stderr).toBe(0)
  expect(readFileSync(join(root, file), 'utf8')).toBe(
    source.replace(
      before + after,
      `${before}\`\`\`\n\n\`\`\`tsx title="Client.tsx"\n${after}`,
    ),
  )
})

it('plans by default, refuses conflicts, and leaves unrelated safe migrations available', async () => {
  const conflicted =
    '---\nname: wrong-name\ndescription: Use the client.\nlibrary: old\nmetadata:\n  library: chosen\n---\nBody\n'
  const safe =
    '---\nname: other\ndescription: Other task.\ntype: core\nmetadata:\n  type: core\n---\nBody\n'
  write('skills/client/SKILL.md', conflicted)
  write('skills/other/SKILL.md', safe)
  expect(await main(['repair', '--json'])).toBe(1)
  expect(readFileSync(join(root, 'skills/other/SKILL.md'), 'utf8')).toBe(safe)
  expect(await main(['repair', '--write', '--json'])).toBe(1)
  expect(readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')).toBe(
    conflicted,
  )
  const repaired = readFileSync(join(root, 'skills/other/SKILL.md'), 'utf8')
  expect(repaired).not.toContain('\ntype: core')
  expect(repaired).toContain('  type: core')
  expect(await main(['repair', '--write', '--json'])).toBe(1)
  expect(readFileSync(join(root, 'skills/other/SKILL.md'), 'utf8')).toBe(
    repaired,
  )
})

it('preflights every write and leaves outside files and earlier safe files unchanged', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'intent-repair-outside-'))
  const source =
    '---\nname: client\ndescription: Use client.\nlibrary: client\n---\nBody\n'
  try {
    write('skills/a/SKILL.md', source)
    writeFileSync(join(outside, 'SKILL.md'), source)
    mkdirSync(join(root, 'skills/z'))
    symlinkSync(
      join(outside, 'SKILL.md'),
      join(root, 'skills/z/SKILL.md'),
      'file',
    )
    expect(await main(['repair', '--write'])).toBe(1)
    expect(readFileSync(join(root, 'skills/a/SKILL.md'), 'utf8')).toBe(source)
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toBe(source)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

it.each([
  'null',
  '[one, two]',
  'metadata: [invalid]',
  'metadata:\n  library: a\n  library: b',
])('reports malformed frontmatter without changing it: %s', async (fields) => {
  const source = `---\n${fields}\n---\nBody\n`
  write('skills/client/SKILL.md', source)
  expect(await main(['repair', '--write', '--json'])).toBe(1)
  expect(readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')).toBe(
    source,
  )
})

it.each([
  '```ts\nconst value = `\n// BEFORE (classic)\nconst count = 1\n// AFTER (new)\nconst count = 2\n`\n```\n',
  '````markdown\n```ts\n// BEFORE\nconst count = 1\n// AFTER\nconst count = 2\n```\n````\n',
  '```ts\nfunction example() {\n// BEFORE\nconst count = 1\n// AFTER\nconst count = 2\n}\n```\n',
  '```ts\n// BEFORE\nconst count = {\n// AFTER\nconst count = 2\n```\n',
  '```ts\n// BEFORE\nconst count = 1\n// AFTER\nconst count = 2\n// AFTER again\nconst count = 3\n```\n',
  '```ts\n// WRONG\nconst count = ...\n// CORRECT\nconst count = 2\n```\n',
  '```ts\n// BEFORE\nconst count = 1\n// AFTER\nconst count = 2\n',
  '```ts\n// BEFORE\nconst value = `\n// AFTER\nconst count = 2\n`\n```\n',
  '```ts\n// BEFORE\nfunction run() {\n// AFTER\nconst count = 2\n}\n```\n',
])(
  'leaves ambiguous, nested, incomplete, and negative examples unchanged',
  (content) => {
    expect(planExampleRepairs(root, content)).toMatchObject({
      content,
      suggestions: [],
    })
  },
)

it.each(['ts', 'tsx', 'js', 'jsx'])(
  'preserves CRLF and code bytes when suggesting separate %s examples',
  (language) => {
    const first = '// BEFORE\r\nconst count = 1\r\n'
    const second = '// AFTER\r\nconst count = 2\r\n'
    const opening = `~~~${language} title="sample"\r\n`
    const content = `${opening}${first}${second}~~~~\r\n`
    const result = planExampleRepairs(root, content)
    expect(result.suggestions).toHaveLength(1)
    expect(result.content).toBe(
      `${opening}${first}~~~~\r\n\r\n${opening}${second}~~~~\r\n`,
    )
    expect(planExampleRepairs(root, result.content).suggestions).toEqual([])
  },
)

it('never applies a code suggestion or creates review state in write mode', async () => {
  const source =
    '---\nname: client\ndescription: Client\n---\n```js\n// BEFORE\nconst value = 1\n// AFTER\nconst value = 2\n```\n'
  write('skills/client/SKILL.md', source)
  expect(await main(['repair', '--write', '--json'])).toBe(0)
  expect(
    JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0]).suggestions,
  ).toHaveLength(1)
  expect(readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')).toBe(
    source,
  )
  expect(existsSync(join(root, '.intent'))).toBe(false)
})

it('requires a single output mode and prints no patch when no repairs are available', async () => {
  for (const option of ['--json', '--write'])
    expect(await main(['repair', '--patch', option])).toBe(1)
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)
  expect(await main(['repair', '--patch'])).toBe(0)
  expect(stdout).toHaveBeenCalledWith('')
})

it('preserves an explicit validate version update when combined with migration', async () => {
  write(
    'skills/client/SKILL.md',
    '---\nname: client\ndescription: Use client.\nlibrary_version: "1.0.0"\n---\nBody\n',
  )
  expect(await main(['validate', '--fix', '--set-version', '2.0.0'])).toBe(0)
  const fields = parse(
    readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8').match(
      /^---\n([\s\S]*?)\n---/,
    )![1]!,
  )
  expect(fields.metadata.library_version).toBe('2.0.0')
  expect(fields.library_version).toBeUndefined()
})

it('preflights the version-update destinations before applying combined fixes', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'intent-version-outside-'))
  const source =
    '---\nname: client\ndescription: Use client.\nlibrary: client\n---\nBody\n'
  const external =
    '---\nname: versioned\ndescription: Versioned.\nmetadata:\n  library_version: "1.0.0"\n---\nBody\n'
  try {
    write('skills/client/SKILL.md', source)
    mkdirSync(join(root, 'skills/versioned'))
    writeFileSync(join(outside, 'SKILL.md'), external)
    symlinkSync(
      join(outside, 'SKILL.md'),
      join(root, 'skills/versioned/SKILL.md'),
      'file',
    )
    expect(await main(['validate', '--fix', '--set-version', '2.0.0'])).toBe(1)
    expect(readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')).toBe(
      source,
    )
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toBe(external)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

it.each([
  '---\nname: &identity wrong-name\ndescription: Use client.\nmetadata:\n  library: *identity\n---\nBody\n',
  '---\nname: client\ndescription: Use client.\ndefaults: &values { library_version: 1.0.0 }\nmetadata: *values\nlibrary: acme\n---\nBody\n',
])(
  'reports YAML alias repairs that cannot preserve other fields',
  async (source) => {
    write('skills/client/SKILL.md', source)
    expect(await main(['repair', '--write', '--json'])).toBe(1)
    expect(readFileSync(join(root, 'skills/client/SKILL.md'), 'utf8')).toBe(
      source,
    )
    const report = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])
    expect(report.repairs).toEqual([])
    expect(report.problems[0].message).toContain('unrelated frontmatter values')
  },
)
