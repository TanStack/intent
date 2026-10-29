import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cli = join(packageRoot, 'dist/cli.mjs')
let root: string
let skillDir: string
const metadata = `---\nname: guide\ndescription: Test guidance\nintent-transform:\n  entry: scripts/transform.mjs\n  api: 1\n---\n`
const code = `
export function load({ config }) {
  return config.exists('saved.json') ? config.readFile('saved.json') : 'Ask Q1';
}
export function configure({ config, answers, stdin }) {
  config.writeFile('saved.json', JSON.stringify({ answers, stdin }));
  return 'Next question';
}
`
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-transform-cli-')))
  skillDir = join(root, 'node_modules', 'example', 'skills', 'guide')
  mkdirSync(join(skillDir, 'scripts'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      dependencies: { example: '1' },
      intent: { skills: ['example'] },
    }),
  )
  writeFileSync(
    join(skillDir, '../..', 'package.json'),
    JSON.stringify({
      name: 'example',
      version: '1.0.0',
      intent: { version: 1, repo: 'example/example', docs: 'docs' },
    }),
  )
  writeFileSync(join(skillDir, 'SKILL.md'), metadata + 'Bootstrap')
  writeFileSync(join(skillDir, 'scripts/transform.mjs'), code)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function run(file: string, args: Array<string>, input = '') {
  return spawnSync(process.execPath, [file, ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 15000,
  })
}

describe.skipIf(Number(process.versions.node.split('.')[0]) < 22)(
  'packaged transform runners',
  () => {
    it('runs from published files without installed runtime dependencies', () => {
      const installed = join(root, 'standalone-intent')
      mkdirSync(installed)
      cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), {
        recursive: true,
      })
      cpSync(join(packageRoot, 'package.json'), join(installed, 'package.json'))
      const result = run(join(installed, 'dist/cli.mjs'), [
        'load',
        'example#guide',
      ])
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe('Ask Q1')
    })

    it('forwards trailing load arguments as strings', () => {
      writeFileSync(
        join(skillDir, 'scripts/transform.mjs'),
        'export function load({ args }) { return JSON.stringify(args); }',
      )
      const result = run(cli, [
        'load',
        'example#guide',
        'reconfigure',
        '001',
        'a=b',
      ])
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(['reconfigure', '001', 'a=b'])
      const escaped = run(cli, [
        'load',
        'example#guide',
        'reconfigure',
        '--',
        '--custom',
        '001',
      ])
      expect(escaped.status, escaped.stderr).toBe(0)
      expect(JSON.parse(escaped.stdout)).toEqual([
        'reconfigure',
        '--custom',
        '001',
      ])
    })

    it('resets configuration transactionally before forwarding new answers', () => {
      expect(
        run(cli, ['configure', 'example#guide', '--answer', 'Q1=old']).status,
      ).toBe(0)
      writeFileSync(
        join(skillDir, 'scripts/transform.mjs'),
        `
        export function configure({ config, answers }) {
          if (config.listFiles().length) throw new Error('Expected empty config');
          if (!answers.length) throw new Error('Abort reset');
          config.writeFile('new.json', JSON.stringify(answers));
          return 'Reset';
        }
        export function load({ config }) { return JSON.stringify(config.listFiles()); }
      `,
      )
      const failed = run(cli, ['configure', 'example#guide', '--reset'])
      expect(failed.status).not.toBe(0)
      expect(failed.stderr).toContain('Abort reset')
      expect(JSON.parse(run(cli, ['load', 'example#guide']).stdout)).toEqual([
        'saved.json',
      ])
      const reset = run(cli, [
        'configure',
        'example#guide',
        '--reset',
        '--answer',
        'Q2=new',
      ])
      expect(reset.status, reset.stderr).toBe(0)
      expect(reset.stdout).toBe('Reset')
      expect(JSON.parse(run(cli, ['load', 'example#guide']).stdout)).toEqual([
        'new.json',
      ])
    })

    it('allows reset and stdin-only configuration without answer flags', () => {
      expect(
        run(cli, ['configure', 'example#guide', '--answer', 'Q1=old']).status,
      ).toBe(0)
      writeFileSync(
        join(skillDir, 'scripts/transform.mjs'),
        `
        export function configure({ config, answers, stdin }) {
          if (answers.length) throw new Error('Expected no answers');
          if (!stdin && config.listFiles().length) throw new Error('Expected reset');
          if (stdin) config.writeFile('stdin.txt', stdin);
          return 'Saved';
        }
        export function load({ config }) { return JSON.stringify(config.listFiles()); }
      `,
      )
      const reset = run(cli, ['configure', 'example#guide', '--reset'])
      expect(reset.status, reset.stderr).toBe(0)
      expect(JSON.parse(run(cli, ['load', 'example#guide']).stdout)).toEqual([])
      const configured = run(cli, ['configure', 'example#guide'], 'preferences')
      expect(configured.status, configured.stderr).toBe(0)
      expect(JSON.parse(run(cli, ['load', 'example#guide']).stdout)).toEqual([
        'stdin.txt',
      ])
    })

    it('forwards repeated string flags and stdin, and keeps JSON/path modes intact', () => {
      const configured = run(
        cli,
        [
          'configure',
          'example#guide',
          '--answer',
          'Q1=001',
          '--answer',
          'Q2=',
          '--answer=Q1=a=b\nsecond line',
          '--answer',
          'Q3=-1',
        ],
        '{"complex":[1,2]}\n',
      )
      expect(configured.status, configured.stderr).toBe(0)
      expect(configured.stdout).toBe('Next question')
      const loaded = run(cli, ['load', 'example#guide', '--json'])
      expect(loaded.status, loaded.stderr).toBe(0)
      expect(JSON.parse(JSON.parse(loaded.stdout).content)).toEqual({
        answers: [
          { question: 'Q1', answer: '001' },
          { question: 'Q2', answer: '' },
          { question: 'Q1', answer: 'a=b\nsecond line' },
          { question: 'Q3', answer: '-1' },
        ],
        stdin: '{"complex":[1,2]}\n',
      })
      const path = run(cli, ['load', 'example#guide', '--path'])
      expect(path.stdout.trim()).toContain('SKILL.md')
      expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toBe(
        metadata + 'Bootstrap',
      )
      for (const answer of ['missing', '=value']) {
        const failed = run(cli, [
          'configure',
          'example#guide',
          '--answer',
          answer,
        ])
        expect(failed.status).toBe(1)
        expect(failed.stderr).toContain('question=value')
      }
    })

    it('reflects an actual npm run invocation in both transform functions', () => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          dependencies: { example: '1' },
          intent: { skills: ['example'] },
          scripts: { intent: 'node "' + cli + '"' },
        }),
      )
      writeFileSync(
        join(skillDir, 'scripts/transform.mjs'),
        `export function load({ commands }) { return JSON.stringify(commands) } export const configure = load;`,
      )
      for (const action of ['load', 'configure']) {
        const result = spawnSync(
          'npm',
          ['run', '--silent', 'intent', '--', action, 'example#guide'],
          {
            cwd: root,
            input: '',
            encoding: 'utf8',
            timeout: 15000,
            shell: process.platform === 'win32',
          },
        )
        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({
          load: "npm run 'intent' -- load 'example#guide'",
          configure: "npm run 'intent' -- configure 'example#guide'",
        })
      }
    })

    it.skipIf(process.platform === 'win32')(
      'preserves the package version through an offline npx launch',
      () => {
        const version = JSON.parse(
          readFileSync(join(packageRoot, 'package.json'), 'utf8'),
        ).version
        mkdirSync(join(root, 'node_modules/@tanstack'), { recursive: true })
        mkdirSync(join(root, 'node_modules/.bin'), { recursive: true })
        symlinkSync(
          packageRoot,
          join(root, 'node_modules/@tanstack/intent'),
          'dir',
        )
        symlinkSync(cli, join(root, 'node_modules/.bin/intent'))
        writeFileSync(
          join(skillDir, 'scripts/transform.mjs'),
          `export function load({ commands }) { return JSON.stringify(commands) }`,
        )
        const result = spawnSync(
          'npx',
          ['--offline', `@tanstack/intent@${version}`, 'load', 'example#guide'],
          {
            cwd: root,
            input: '',
            encoding: 'utf8',
            timeout: 15000,
          },
        )
        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({
          load: `npx @tanstack/intent@${version} load 'example#guide'`,
          configure: `npx @tanstack/intent@${version} configure 'example#guide'`,
        })
      },
    )
  },
)
