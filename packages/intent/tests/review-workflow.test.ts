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
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { main } from '../src/cli.js'
import { createReview, recordReview } from '../src/review/review.js'

let root: string
let cwd: string
const templatePath = fileURLToPath(
  new URL('../meta/templates/workflows/check-skills.yml', import.meta.url),
)
beforeEach(() => {
  cwd = process.cwd()
  root = mkdtempSync(join(tmpdir(), 'intent-review-workflow-'))
  process.chdir(root)
  execFileSync('git', ['init', '-q'])
  execFileSync('git', [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  ])
})
afterEach(() => {
  process.chdir(cwd)
  rmSync(root, { recursive: true, force: true })
})

it('writes release reminders for unreviewed source and none after a recorded outcome', async () => {
  writeFileSync('new-api.ts', 'export const enabled = true\n')
  expect(await main(['review', '--github-review'])).toBe(0)
  expect(JSON.parse(readFileSync('review-items.json', 'utf8'))[0].type).toBe(
    'unmapped-change',
  )
  expect(readFileSync('pr-body.md', 'utf8')).toContain('new-api.ts')
  rmSync('review-items.json')
  rmSync('pr-body.md')
  const report = createReview(root)
  report.items[0]!.outcome = 'out-of-scope'
  report.items[0]!.reason = 'Internal fixture setup, no public developer task.'
  report.items[0]!.evidence = ['new-api.ts']
  recordReview(root, report)
  expect(await main(['review', '--github-review'])).toBe(0)
  expect(JSON.parse(readFileSync('review-items.json', 'utf8'))).toEqual([])
  expect(existsSync('pr-body.md')).toBe(false)
})

it('keeps corrupt state visible as a release check failure', async () => {
  mkdirSync('.intent')
  writeFileSync('.intent/review-state.json', 'not json')
  expect(await main(['review', '--github-review'])).toBe(0)
  expect(JSON.parse(readFileSync('review-items.json', 'utf8'))[0].type).toBe(
    'review-check-failed',
  )
  expect(readFileSync('pr-body.md', 'utf8')).toContain('Invalid review state')
})

it('runs the PR gate for maintainer instructions before any review state exists', () => {
  const template = parse(readFileSync(templatePath, 'utf8')) as {
    jobs: { validate: { steps: Array<{ name: string; run?: string }> } }
  }
  const script = template.jobs.validate.steps.find(
    (step) => step.name === 'Check recorded source reviews',
  )!.run!
  mkdirSync('bin')
  writeFileSync(
    'bin/intent',
    '#!/bin/sh\nprintf "%s\\n" "$@" > checked-args\n',
    { mode: 0o755 },
  )
  const options = {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      INTENT_REVIEW_BASE: 'fixture-base',
    },
  }
  execFileSync('bash', ['-c', script], options)
  expect(existsSync('checked-args')).toBe(false)
  writeFileSync('CLAUDE.md', '<!-- intent-maintainer:start -->\n')
  execFileSync('bash', ['-c', script], options)
  expect(readFileSync('checked-args', 'utf8')).toBe(
    'review\n--base\nfixture-base\n--check\n',
  )
  rmSync('CLAUDE.md')
  rmSync('checked-args')
  mkdirSync('.intent')
  writeFileSync('.intent/review-state.json', '{}')
  execFileSync('bash', ['-c', script], options)
  expect(existsSync('checked-args')).toBe(true)
})
