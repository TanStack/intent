import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  configureIntentSkill,
  listIntentSkills,
  loadIntentSkill,
  resolveIntentSkill,
} from '../src/core/index.js'
import {
  parseAnswerPairs,
  readTransformDeclaration,
  runTransform,
  skillConfigDirectory,
} from '../src/transforms/runtime.js'

let root: string
let skillDir: string
const use = '@example/library#guide'
const source = `---\nname: guide\ndescription: Help with this library\nintent-transform:\n  entry: ./transform.mjs\n  api: 1\n---\nBootstrap\n`
const transform = `
export function load({ skill, config }) {
  const answers = config.exists('answers.json') ? JSON.parse(config.readFile('answers.json')) : {};
  return answers.Q1 ? 'Use ' + answers.Q1 + ': ' + skill.readFile('references/guide.md') : 'Ask Q1';
}
export function configure({ config, answers, stdin }) {
  const saved = config.exists('answers.json') ? JSON.parse(config.readFile('answers.json')) : {};
  for (const { question, answer } of answers) saved[question] = answer;
  if (stdin) Object.assign(saved, JSON.parse(stdin));
  config.writeFile('answers.json', JSON.stringify(saved));
  return 'Saved; load the skill again';
}
`

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-transform-')))
  skillDir = join(
    root,
    'node_modules',
    '@example',
    'library',
    'skills',
    'guide',
  )
  mkdirSync(join(skillDir, 'references'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'consumer',
      dependencies: { '@example/library': '1' },
      intent: { skills: ['@example/library'] },
    }),
  )
  writeFileSync(
    join(skillDir, '..', '..', 'package.json'),
    JSON.stringify({
      name: '@example/library',
      version: '1.0.0',
      keywords: ['tanstack-intent'],
      intent: { version: 1, repo: 'example/library', docs: 'docs/' },
    }),
  )
  writeFileSync(join(skillDir, 'SKILL.md'), source)
  writeFileSync(join(skillDir, 'transform.mjs'), transform)
  writeFileSync(
    join(skillDir, 'references', 'guide.md'),
    '[guide](references/guide.md)',
  )
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('validates declarations and preserves answer text and order', () => {
  expect(readTransformDeclaration(source)).toEqual({
    entry: 'transform.mjs',
    api: 1,
  })
  expect(() =>
    readTransformDeclaration(
      source.replace('./transform.mjs', '../escape.mjs'),
    ),
  ).toThrow()
  expect(() =>
    readTransformDeclaration(source.replace('api: 1', 'api: 2')),
  ).toThrow()
  expect(parseAnswerPairs(['Q1=001', 'Q1='])).toEqual([
    { question: 'Q1', answer: '001' },
    { question: 'Q1', answer: '' },
  ])
  expect(parseAnswerPairs('Q2=a=b\nsecond line')).toEqual([
    { question: 'Q2', answer: 'a=b\nsecond line' },
  ])
  expect(parseAnswerPairs(undefined)).toEqual([])
  for (const invalid of ['Q1', '=value', '', 42, true]) {
    expect(() => parseAnswerPairs(invalid)).toThrow(/question=value/)
  }
})

const modernNode = Number(process.versions.node.split('.')[0]) >= 22
describe.skipIf(!modernNode)('restricted transform execution', () => {
  it('passes the same launcher-aware commands to load and configure', () => {
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      `export function load({ commands }) { return JSON.stringify(commands) } export const configure = load;`,
    )
    const options = { cwd: root, commandPrefix: 'npx @tanstack/intent@latest' }
    const expected = {
      load: `npx @tanstack/intent@latest load '${use}'`,
      configure: `npx @tanstack/intent@latest configure '${use}'`,
    }
    expect(JSON.parse(loadIntentSkill(use, options).content)).toEqual(expected)
    expect(JSON.parse(configureIntentSkill(use, {}, options).content)).toEqual(
      expected,
    )
  })
  it('onboards incrementally, forwards stdin, and retains preferences after an upgrade', () => {
    expect(loadIntentSkill(use, { cwd: root }).content).toBe('Ask Q1')
    expect(
      configureIntentSkill(
        use,
        { answers: [{ question: 'Q1', answer: 'closures' }] },
        { cwd: root },
      ).content,
    ).toContain('Saved')
    configureIntentSkill(use, { stdin: '{"Q2":"fragments"}' }, { cwd: root })
    expect(loadIntentSkill(use, { cwd: root }).content).toContain(
      'Use closures: [guide](node_modules/',
    )
    const configDir = skillConfigDirectory(root, '@example/library', 'guide')
    expect(
      JSON.parse(readFileSync(join(configDir, 'answers.json'), 'utf8')),
    ).toEqual({ Q1: 'closures', Q2: 'fragments' })
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      transform.replace(
        'return answers.Q1 ?',
        "if (!answers.Q3) return 'Ask Q3'; return answers.Q1 ?",
      ),
    )
    expect(loadIntentSkill(use, { cwd: root }).content).toBe('Ask Q3')
    configureIntentSkill(use, { stdin: '{"Q3":"yes"}' }, { cwd: root })
    expect(loadIntentSkill(use, { cwd: root }).content).toContain(
      'Use closures',
    )
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toBe(source)
  })

  it('never executes during discovery or path resolution, and enforces source policy', () => {
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      'throw new Error("must not execute")',
    )
    expect(listIntentSkills({ cwd: root }).skills).toHaveLength(1)
    expect(resolveIntentSkill(use, { cwd: root }).path).toContain('SKILL.md')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ intent: { skills: [] } }),
    )
    expect(() => configureIntentSkill(use, {}, { cwd: root })).toThrow(
      /not listed/,
    )
    expect(() => loadIntentSkill(use, { cwd: root })).toThrow(/not listed/)
  })

  it.each([
    [
      'exception',
      'config.writeFile("bad", "data"); throw new Error("failure")',
    ],
    ['invalid result', 'config.writeFile("bad", "data"); return 42'],
    [
      'promise',
      'config.writeFile("bad", "data"); return Promise.resolve("no")',
    ],
    ['traversal', 'config.writeFile("../outside", "data"); return "no"'],
    ['infinite loop', 'while (true) {}'],
    ['skill writes', 'skill.writeFile("SKILL.md", "changed"); return "no"'],
  ])('rolls back config on %s', (_name, body) => {
    configureIntentSkill(use, { stdin: '{"Q1":"original"}' }, { cwd: root })
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      `export function configure({ config, skill }) { ${body} }`,
    )
    expect(() => configureIntentSkill(use, {}, { cwd: root })).toThrow()
    const configDir = skillConfigDirectory(root, '@example/library', 'guide')
    expect(
      JSON.parse(readFileSync(join(configDir, 'answers.json'), 'utf8')),
    ).toEqual({ Q1: 'original' })
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toBe(source)
  })

  it('withholds globals and imports and restricts host permissions', () => {
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      `export function load() { return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof WebSocket, typeof XMLHttpRequest].join(',') }`,
    )
    expect(loadIntentSkill(use, { cwd: root }).content).toBe(
      'undefined,undefined,undefined,undefined,undefined,undefined',
    )
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      `import fs from 'node:fs'; export function load() { return 'bad' }`,
    )
    expect(() => loadIntentSkill(use, { cwd: root })).toThrow(
      /imports are disabled/,
    )
    // Even a host-function escape from the best-effort VM encounters the
    // permission-restricted subprocess. Network permission is enforced on
    // Node 25+ only; older versions also return false for unknown scopes.
    // No network request is made.
    writeFileSync(
      join(skillDir, 'transform.mjs'),
      `export function load({ skill }) {
      const p = skill.readFile.constructor('return process')();
      return JSON.stringify({ network: p.permission.has('net'), write: p.permission.has('fs.write'), env: Object.keys(p.env) });
    }`,
    )
    expect(JSON.parse(loadIntentSkill(use, { cwd: root }).content)).toEqual({
      network: false,
      write: false,
      env: [],
    })
  })

  it('rejects symlinks and concurrent writers', () => {
    const configDir = join(root, 'config')
    mkdirSync(configDir + '.lock')
    const run = () =>
      runTransform({
        skillDir,
        configDir,
        declaration: { entry: 'transform.mjs', api: 1 },
        operation: 'load',
        commands: {
          load: 'intent load test',
          configure: 'intent configure test',
        },
      })
    expect(run).toThrow(/busy/)
    rmSync(configDir + '.lock', { recursive: true })
    symlinkSync(join(root, 'package.json'), join(skillDir, 'outside'))
    expect(run).toThrow(/symbolic links/)
  })
})
