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
import * as blockChecks from '../src/validate/blocks.js'

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

it('supports APIs that require strict null checks while rejecting null arguments', () => {
  write(
    'src/index.ts',
    "export declare function createRouter(options: undefined extends number ? 'strictNullChecks must be enabled' : { routeTree: object }): void\n",
  )
  skill(
    "```ts\nimport { createRouter } from '@acme/client'\ncreateRouter({ routeTree: {} })\n```\n",
  )
  expect(check().findings).toEqual([])
  skill(
    "```ts\nimport { createRouter } from '@acme/client'\ncreateRouter({ routeTree: null })\n```\n",
  )
  expect(check().findings).toContainEqual(
    expect.objectContaining({ message: expect.stringMatching(/TS2322/) }),
  )
})

it('tolerates omitted shorthand values without suppressing incompatible options', () => {
  skill(
    "```ts\nimport { retry } from '@acme/client'\nconst context = { createContext }\nretry(() => fetchItems(context), { max: 'many' })\n```\n",
  )
  expect(check().findings.map((finding) => finding.message)).toEqual([
    expect.stringMatching(/TS2322/),
  ])
})

it('parses a plain ts block as TypeScript rather than TSX', () => {
  skill(
    "```ts\nimport { retry } from '@acme/client'\nconst pick = <T>(value: T) => value\nawait retry(() => Promise.resolve(), { max: pick(3) })\n```\n\n```tsx\nconst view = <div>{String(1)}</div>\n```\n",
  )
  expect(check().findings).toEqual([])
})

it.each(['ts', 'tsx', 'js', 'jsx'])(
  'keeps declarations in separate %s examples independent',
  (language) => {
    skill(
      `\`\`\`${language}\nconst count = 1\n\`\`\`\n\n\`\`\`${language}\nconst count = 2\n\`\`\`\n`,
    )
    const result = check()
    expect(result.blocks).toBe(2)
    expect(result.skipped).toBeUndefined()
    expect(result.findings).toEqual([])
  },
)

it.each(['js', 'jsx'])(
  'checks library option types in %s examples',
  (language) => {
    skill(
      `\`\`\`${language}\nimport { retry } from '@acme/client'\nretry(() => fetchItems(), { max: 'many' })\n\`\`\`\n`,
    )
    expect(check().findings).toEqual([
      expect.objectContaining({
        line: 10,
        message: expect.stringMatching(/TS2322/),
      }),
    ])
  },
)

it.each([
  ['javascript with CRLF', '```javascript\r\n', '\r\n```\r\n'],
  ['JSX with a longer closing fence', '```jsx\n', '\n````\n'],
  ['TypeScript with a tilde fence', '~~~typescript\n', '\n~~~~\n'],
  ['an unclosed JavaScript fence', '```js\n', '\n'],
])('does not skip invalid examples in %s', (_name, opening, closing) => {
  skill(
    `${opening}import { retry } from '@acme/client'\nretry(() => Promise.resolve(), { max: 'many' })${closing}`,
  )
  const result = check()
  expect(result.blocks).toBe(1)
  expect(result.skipped).toBeUndefined()
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      line: 10,
      message: expect.stringMatching(/TS2322/),
    }),
  )
})

it.each(['jsx', 'tsx'])(
  'checks actual component props and syntax in %s',
  async (language) => {
    write(
      'src/index.ts',
      'export function Counter(props: { count: number; children?: unknown }) { return null }\n',
    )
    const example = (expression: string) =>
      `\`\`\`${language}\nimport { Counter } from '@acme/client'\nconst view = ${expression}\n\`\`\`\n`
    skill(example('<Counter count={3}><span>Ready</span></Counter>'))
    expect(check()).toMatchObject({ blocks: 1, findings: [] })
    expect(check().skipped).toBeUndefined()
    expect(await main(['validate'])).toBe(0)
    skill(example('<Counter count="many" />'))
    expect(check().findings).toContainEqual(
      expect.objectContaining({
        line: 10,
        message: expect.stringMatching(/TS2322/),
      }),
    )
    expect(await main(['validate'])).toBe(1)
    skill(example('<Counter count={3}>'))
    expect(check().findings).toContainEqual(
      expect.objectContaining({
        line: 10,
        message: expect.stringMatching(/TS17008/),
      }),
    )
  },
)

it('checks JSDoc contracts from a JavaScript library instead of skipping it', () => {
  rmSync(join(root, 'src/index.ts'))
  write(
    'package.json',
    JSON.stringify({
      name: '@acme/client',
      version: '1.0.0',
      exports: './src/index.js',
    }),
  )
  write(
    'src/index.js',
    '/** @param {{ max: number }} options */\nexport function retry(options) { return options.max }\n',
  )
  skill(
    "```javascript\nimport { retry } from '@acme/client'\nretry({ max: 'many' })\n```\n",
  )
  const result = check()
  expect(result.skipped).toBeUndefined()
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      line: 10,
      message: expect.stringMatching(/TS2322/),
    }),
  )
})

it('never executes examples or the library while validating them', () => {
  write(
    'src/index.ts',
    `${read('src/index.ts')}\nthrow new Error('The validator executed the library')\n`,
  )
  skill(
    "```js\nimport { retry } from '@acme/client'\nimport { writeFileSync } from 'node:fs'\nwriteFileSync('example-executed', 'unsafe')\nretry(() => Promise.resolve(), { max: 3 })\n```\n",
  )
  expect(check()).toMatchObject({ blocks: 1, findings: [] })
  expect(existsSync(join(root, 'example-executed'))).toBe(false)
})

it.each(['js', 'jsx'])(
  'checks a tracked %s entry declared outside src/index',
  (extension) => {
    rmSync(join(root, 'src'), { recursive: true })
    const entry = `lib/client.${extension}`
    write(
      'package.json',
      JSON.stringify({
        name: '@acme/client',
        ...(extension === 'js'
          ? { exports: { '.': { import: `./${entry}` } } }
          : { main: entry }),
      }),
    )
    write(
      entry,
      '/** @param {{ max: number }} options */\nexport function retry(options) { return options.max }\n',
    )
    execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
      cwd: root,
    })
    execFileSync('git', ['-c', 'core.fsmonitor=false', 'add', entry], {
      cwd: root,
    })
    skill(
      `\`\`\`${extension}\nimport { retry } from '@acme/client'\nretry({ max: 'many' })\n\`\`\`\n`,
    )
    const result = check()
    expect(result.skipped).toBeUndefined()
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        line: 10,
        message: expect.stringMatching(/TS2322/),
      }),
    )
  },
)

it('keeps nested examples inside a Markdown fence and still checks following prose links', () => {
  skill(
    '````markdown\n```jsx\nconst view = <Broken />\n```\n[example](not-a-real-link.md)\n`````\n\nSee [missing](missing.md).\n',
  )
  expect(check()).toMatchObject({
    blocks: 0,
    findings: [
      expect.objectContaining({
        line: 15,
        message: 'Link target not found: missing.md',
      }),
    ],
  })
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
      '```ts',
      'const broken = {',
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
    // An example that does not parse is reported instead of passing unchecked.
    expect.objectContaining({
      line: 21,
      severity: 'error',
      message: expect.stringMatching(/TS1005/),
    }),
  ])
})

it('warns on deprecated imports and fails broken relative links', () => {
  write('skills/retries/references/backoff.md', '# Backoff\n')
  skill(
    [
      'See [backoff](<references/backoff.md#top>), [again](<../retries/references/backoff.md>), and [missing](references/missing.md#top).',
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

it('revalidates unchanged skills after an imported source or link target changes', async () => {
  write('src/index.ts', "export { retry } from './retry'\n")
  write(
    'src/retry.ts',
    'export function retry(options: { max: number }): void {}\n',
  )
  write('skills/retries/reference.md', '# Reference\n')
  skill(
    "See [reference](reference.md).\n\n```ts\nimport { retry } from '@acme/client'\nretry({ max: 3 })\n```\n",
  )
  expect(await main(['validate'])).toBe(0)
  write(
    'src/retry.ts',
    'export function retry(options: { max: string }): void {}\n',
  )
  rmSync(join(root, 'skills/retries/reference.md'))
  expect(await main(['validate'])).toBe(1)
  const errors = vi.mocked(console.error).mock.calls.flat().join('\n')
  expect(errors).toContain('TS2322')
  expect(errors).toContain('Link target not found: reference.md')
})

it.each(['__proto__', 'constructor'])(
  'accepts %s as a library name without crashing',
  async (library) => {
    write('package.json', JSON.stringify({ name: library, version: '1.0.0' }))
    skill(
      `\`\`\`ts\nimport { retry } from '${library}'\nretry(() => fetchItems(), { max: 3 })\n\`\`\`\n`,
    )
    expect(await main(['validate'])).toBe(0)
  },
)

it('checks prose links without loading TypeScript', () => {
  write('node_modules/typescript/package.json', '{"main":"index.cjs"}\n')
  write(
    'node_modules/typescript/index.cjs',
    "require('node:fs').writeFileSync('typescript-loaded', '')\n",
  )
  skill('See [missing](missing.md).\n')
  expect(check().findings).toEqual([
    expect.objectContaining({ message: 'Link target not found: missing.md' }),
  ])
  expect(existsSync(join(root, 'typescript-loaded'))).toBe(false)
})

it('uses tracked hand-written declarations and maps build output back to source', () => {
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
    cwd: root,
  })
  write('.gitignore', 'dist/\n')
  write('dist/index.d.ts', 'export declare function retry(): void\n')
  write('package.json', '{"name":"@acme/client","types":"dist/index.d.ts"}\n')
  skill(
    "```ts\nimport { retry } from '@acme/client'\nawait retry(() => Promise.resolve(), { max: 3 })\n```\n",
  )
  // dist/ is ignored, so src/index.ts stands in and the call typechecks.
  expect(check().findings).toEqual([])
  write('types/index.d.ts', 'export declare function retry(): void\n')
  write('package.json', '{"name":"@acme/client","types":"types/index.d.ts"}\n')
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'add', 'types'], {
    cwd: root,
  })
  // A tracked declaration file is the public surface, and the call no longer fits it.
  expect(check().findings).toEqual([
    expect.objectContaining({
      line: 10,
      message: expect.stringMatching(/TS2554/),
    }),
  ])
})

it('checks imports from sibling workspace packages against their own source', () => {
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write('packages/client/package.json', '{"name":"@acme/client"}\n')
  write(
    'packages/client/src/index.ts',
    "import type { Adapter } from '@acme/adapter'\nexport function run<A extends Adapter>(options: { adapter: A; model: A['models'][number] }): void {}\n",
  )
  write('packages/adapter/package.json', '{"name":"@acme/adapter"}\n')
  write(
    'packages/adapter/src/index.ts',
    "export interface Adapter { models: ReadonlyArray<string> }\nexport function openai(): { models: readonly ['gpt-5'] } { return { models: ['gpt-5'] } }\n",
  )
  write(
    'packages/client/skills/run/SKILL.md',
    [
      '---',
      'name: run',
      'description: Use when running.',
      '---',
      '```ts',
      "import { run } from '@acme/client'",
      "import { openai, anthropic } from '@acme/adapter'",
      "run({ adapter: openai(), model: 'gpt-9000' })",
      '```',
      '',
    ].join('\n'),
  )
  const findings = checkSkillBlocks({
    root,
    packageDir: join(root, 'packages/client'),
    library: '@acme/client',
    skills: [
      {
        file: 'packages/client/skills/run/SKILL.md',
        content: readFileSync(
          join(root, 'packages/client/skills/run/SKILL.md'),
          'utf8',
        ),
      },
    ],
  }).findings
  expect(findings).toEqual([
    expect.objectContaining({
      line: 7,
      message: expect.stringMatching(/TS2305: .*'anthropic'/),
    }),
    expect.objectContaining({
      line: 8,
      message: expect.stringMatching(/TS2322: .*gpt-9000/),
    }),
  ])
})

it('ignores links inside fenced examples and checks a skill that documents a sibling package', () => {
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write('packages/client/package.json', '{"name":"@acme/client"}\n')
  write('packages/client/src/index.ts', 'export const client = 1\n')
  write('packages/adapter/package.json', '{"name":"@acme/adapter"}\n')
  write('packages/adapter/src/index.ts', 'export function openai(): void {}\n')
  write(
    'packages/client/skills/adapters/SKILL.md',
    [
      '---',
      'name: adapters',
      'description: Use when choosing an adapter.',
      'metadata:',
      '  library: "@acme/adapter"',
      '---',
      '```md',
      'A [link inside an example](does-not-exist.md) is not checked.',
      '```',
      '```ts',
      "import { openai, gemini } from '@acme/adapter'",
      '```',
      '',
    ].join('\n'),
  )
  const findings = checkSkillBlocks({
    root,
    packageDir: join(root, 'packages/client'),
    library: '@acme/adapter',
    skills: [
      {
        file: 'packages/client/skills/adapters/SKILL.md',
        content: readFileSync(
          join(root, 'packages/client/skills/adapters/SKILL.md'),
          'utf8',
        ),
      },
    ],
  }).findings
  expect(findings).toEqual([
    expect.objectContaining({
      line: 11,
      message: expect.stringMatching(/TS2305: .*'gemini'/),
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
  expect(
    checkSkillBlocks(
      {
        root,
        packageDir: root,
        library: '@acme/client',
        skills: [
          {
            file: 'skills/retries/SKILL.md',
            content: read('skills/retries/SKILL.md'),
          },
        ],
      },
      { version: '4.9.5', versionMajorMinor: '4.9' } as never,
    ).skipped,
  ).toMatch(/TypeScript 4\.9\.5 is installed; 5\.0 or newer/)
  rmSync(join(root, 'src'), { recursive: true })
  expect(check().skipped).toMatch(/no type entry found for @acme\/client/)
})

it('fails validate on a broken example and reports compile status on pending reviews', async () => {
  skill(
    "```ts\nimport { retry } from '@acme/client'\nawait retry(() => Promise.resolve(), { max: 'many' })\n```\n",
  )
  expect(await main(['validate'])).toBe(1)
  expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
    `${join('skills', 'retries', 'SKILL.md')}:10: TS2322`,
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
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e',
      'commit',
      '-qam',
      'add delay',
    ],
    { cwd: root },
  )
  vi.mocked(console.log).mockClear()
  expect(await main(['maintainer', 'status'])).toBe(0)
  expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
    'Review skill skills/retries/SKILL.md: changed src/index.ts; examples still compile',
  )
  const descriptions = vi.spyOn(blockChecks, 'describeSkillExamples')
  const checks = vi.spyOn(blockChecks, 'checkSkillBlocks')
  expect(await main(['maintainer', 'check'])).toBe(1) // pending source review
  expect(checks).toHaveBeenCalledTimes(1)
  expect(descriptions).not.toHaveBeenCalled()
  checks.mockClear()
  write(
    'src/index.ts',
    read('src/index.ts').replace('max: number', 'max: string'),
  )
  vi.mocked(console.error).mockClear()
  expect(await main(['maintainer', 'check'])).toBe(1)
  expect(checks).toHaveBeenCalledTimes(1)
  expect(descriptions).not.toHaveBeenCalled()
  expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
    'TS2322',
  )
  expect(existsSync(join(root, '.intent/skill-examples'))).toBe(false)
})

function read(path: string) {
  return readFileSync(join(root, path), 'utf8')
}
