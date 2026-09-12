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
import { main } from '../src/cli.js'
import { checkSkillBlocks } from '../src/validate/blocks.js'

// Typechecking examples against a real package takes longer than a unit test.
vi.setConfig({ testTimeout: 30_000 })

let root: string
let previousCwd: string

function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function skill(body: string) {
  write(
    'skills/retries/SKILL.md',
    `---\nname: retries\ndescription: Use when retrying requests.\nsources: [src/index.ts]\n---\n# Retries\n\n${body}`,
  )
}

function check() {
  return checkSkillBlocks({
    root,
    packageDir: root,
    library: '@acme/client',
    skills: [
      {
        file: 'skills/retries/SKILL.md',
        content: readFileSync(join(root, 'skills/retries/SKILL.md'), 'utf8'),
      },
    ],
  })
}

beforeEach(() => {
  previousCwd = process.cwd()
  root = mkdtempSync(join(tmpdir(), 'intent-blocks-'))
  process.chdir(root)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  write('package.json', '{"name":"@acme/client","version":"1.0.0"}\n')
  write(
    'src/index.ts',
    [
      'export interface RetryOptions { max: number }',
      'export function retry(fn: () => Promise<unknown>, options: RetryOptions): Promise<{ ok: boolean }> {',
      '  return fn().then(() => ({ ok: options.max > 0 }))',
      '}',
      '/** @deprecated Use retry. */',
      'export function legacyRetry(): void {}',
      '',
    ].join('\n'),
  )
})
afterEach(() => {
  process.chdir(previousCwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('accepts a partial example whose only gaps are names the snippet leaves out', () => {
  skill(
    '```ts\nimport { retry } from \'@acme/client\'\n\nconst result = await retry(() => fetchItems(), { max: 3 })\nresult.ok\n```\n\n```json\n{ "not": "checked" }\n```\n',
  )
  const result = check()
  expect(result.blocks).toBe(1)
  expect(result.findings).toEqual([])
})

it('reports a removed option, a missing export, and a broken example with the skill line', () => {
  skill(
    [
      'Intro line.',
      '',
      '```ts',
      "import { retry, backoff } from '@acme/client'",
      '',
      'await retry(() => fetch("/x"), { attempts: 3 })',
      '```',
      '',
      '```tsx',
      'const count: number = "three"',
      '```',
      '',
    ].join('\n'),
  )
  const findings = check().findings
  expect(findings).toEqual([
    expect.objectContaining({
      line: 11,
      severity: 'error',
      message: expect.stringMatching(/TS2305: .*'backoff'/),
    }),
    expect.objectContaining({
      line: 13,
      severity: 'error',
      message: expect.stringMatching(/TS2353: .*'attempts'/),
    }),
    expect.objectContaining({
      line: 17,
      severity: 'error',
      message: expect.stringMatching(/TS2322/),
    }),
  ])
})

it('warns on deprecated imports and fails broken relative links', () => {
  write('skills/retries/references/backoff.md', '# Backoff\n')
  skill(
    [
      'See [backoff](references/backoff.md) and [missing](references/missing.md#top).',
      'External [docs](https://example.com/x) are not checked.',
      '',
      '```ts',
      "import { legacyRetry } from '@acme/client'",
      'legacyRetry()',
      '```',
      '',
    ].join('\n'),
  )
  expect(check().findings).toEqual([
    expect.objectContaining({
      line: 8,
      severity: 'error',
      message: 'Link target not found: references/missing.md#top',
    }),
    expect.objectContaining({
      line: 12,
      severity: 'warning',
      message: 'legacyRetry is deprecated: Use retry.',
    }),
  ])
})

it('skips typechecking with a reason when TypeScript or a type entry is unavailable', () => {
  skill("```ts\nimport { retry } from '@acme/client'\n```\n")
  expect(
    checkSkillBlocks(
      {
        root,
        packageDir: root,
        library: '@acme/client',
        skills: [
          {
            file: 'skills/retries/SKILL.md',
            content: readFileSync(
              join(root, 'skills/retries/SKILL.md'),
              'utf8',
            ),
          },
        ],
      },
      null,
    ).skipped,
  ).toMatch(/TypeScript is not installed/)
  rmSync(join(root, 'src'), { recursive: true })
  expect(check().skipped).toMatch(/no type entry found for @acme\/client/)
})

it('fails validate on a broken example and reports compile status on pending reviews', async () => {
  skill(
    "```ts\nimport { retry } from '@acme/client'\nawait retry(() => Promise.resolve(), { max: 'many' })\n```\n",
  )
  expect(await main(['validate'])).toBe(1)
  expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toMatch(
    /skills\/retries\/SKILL\.md:10: TS2322/,
  )
  skill(
    "```ts\nimport { retry } from '@acme/client'\nawait retry(() => Promise.resolve(), { max: 3 })\n```\n",
  )
  expect(await main(['validate'])).toBe(0)
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
    cwd: root,
  })
  expect(await main(['maintainer', 'setup'])).toBe(0)
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'add', '.'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e',
      'commit',
      '-qm',
      'init',
    ],
    { cwd: root },
  )
  write(
    'src/index.ts',
    read('src/index.ts').replace('max: number', 'max: number; delay?: number'),
  )
  execFileSync(
    'git',
    ['-c', 'core.fsmonitor=false', 'commit', '-qam', 'add delay'],
    {
      cwd: root,
    },
  )
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'status'])).toBe(0)
  expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
    'Review skill skills/retries/SKILL.md: changed src/index.ts; examples still compile',
  )
  expect(existsSync(join(root, '.intent/skill-examples'))).toBe(false)
})

function read(path: string) {
  return readFileSync(join(root, path), 'utf8')
}
