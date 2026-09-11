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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'
import { createReview, recordReview } from '../src/review/review.js'
import type { ReviewPrompts } from '../src/review/interactive.js'

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
  writeFileSync('package.json', '{"name":"review-fixture","version":"1.0.0"}\n')
  execFileSync('git', ['add', 'package.json'])
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
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('records confirmed interactive outcomes through the existing review checks', async () => {
  writeFileSync('new-api.ts', 'export const enabled = true\n')
  const reviewItem = vi.fn(() =>
    Promise.resolve({
      outcome: 'no-change' as const,
      reason: 'The internal flag does not change the documented API.',
      evidence: ['Inspected new-api.ts and the supported developer tasks.'],
    }),
  )
  const confirm = vi.fn(() => Promise.resolve(true))
  expect(
    await main(['maintainer', 'review', '--interactive'], {
      isTTY: true,
      isCI: false,
      reviewPrompts: { reviewItem, confirm },
    }),
  ).toBe(0)
  expect(reviewItem).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledOnce()
  const state = JSON.parse(readFileSync('.intent/review-state.json', 'utf8'))
  expect(state.items['source:new-api.ts']).toMatchObject({
    outcome: 'no-change',
    reason: 'The internal flag does not change the documented API.',
  })
  expect(createReview(root).items).toEqual([])
})

it('keeps interactive cancellation and CI read-only', async () => {
  writeFileSync('new-api.ts', 'export const enabled = true\n')
  const reviewItem = vi.fn(() => Promise.resolve(null))
  const confirm = vi.fn(() => Promise.resolve(false))
  const runtime = {
    isTTY: true,
    isCI: false,
    reviewPrompts: { reviewItem, confirm },
  }
  expect(await main(['maintainer', 'review', '--interactive'], runtime)).toBe(0)
  expect(existsSync('.intent')).toBe(false)
  reviewItem.mockClear()
  expect(
    await main(['maintainer', 'review', '--interactive'], {
      ...runtime,
      isCI: true,
    }),
  ).toBe(1)
  expect(reviewItem).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
  expect(existsSync('.intent')).toBe(false)
})

it('shows mapped guidance and source changes while leaving unresolved items pending', async () => {
  writeFileSync('new-api.ts', 'export const enabled = true\n')
  writeFileSync('other-api.ts', 'export const pending = true\n')
  mkdirSync('skills/query', { recursive: true })
  writeFileSync(
    'skills/query/SKILL.md',
    '---\nname: query\ndescription: Query\nsources: [new-api.ts]\n---\nUse the enabled flag.\n',
  )
  const reviewItem: ReviewPrompts['reviewItem'] = (item, inspect) => {
    if (item.kind !== 'skill') return Promise.resolve({ outcome: 'unresolved' })
    expect(inspect('guidance')).toContain('Use the enabled flag.')
    expect(inspect('changes')).toContain('export const enabled = true')
    return Promise.resolve({
      outcome: 'updated',
      reason: 'Guidance matches the enabled flag.',
      evidence: ['Read new-api.ts: enabled is true.'],
    })
  }
  expect(
    await main(['maintainer', 'review', '--interactive'], {
      isTTY: true,
      isCI: false,
      reviewPrompts: {
        reviewItem,
        confirm: () => Promise.resolve(true),
      },
    }),
  ).toBe(0)
  expect(createReview(root).items.map((item) => item.id)).toEqual([
    'source:other-api.ts',
  ])
})

it('rejects interactive decisions after source edits without recording partial outcomes', async () => {
  writeFileSync('new-api.ts', 'export const enabled = true\n')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(
    await main(['maintainer', 'review', '--interactive'], {
      isTTY: true,
      isCI: false,
      reviewPrompts: {
        reviewItem: () =>
          Promise.resolve({
            outcome: 'no-change',
            reason: 'Inspected the flag.',
            evidence: ['new-api.ts: enabled is true.'],
          }),
        confirm: () => {
          writeFileSync('new-api.ts', 'export const enabled = false\n')
          return Promise.resolve(true)
        },
      },
    }),
  ).toBe(1)
  expect(error.mock.calls.flat().join('\n')).toContain(
    'changed since this report',
  )
  expect(existsSync('.intent/review-state.json')).toBe(false)
})

it('requires evidence and rejects mixed interactive output modes', async () => {
  writeFileSync('new-api.ts', 'export const enabled = true\n')
  const runtime = {
    isTTY: true,
    isCI: false,
    reviewPrompts: {
      reviewItem: () =>
        Promise.resolve({
          outcome: 'no-change' as const,
          reason: '',
          evidence: [],
        }),
      confirm: () => Promise.resolve(true),
    },
  }
  expect(await main(['maintainer', 'review', '--interactive'], runtime)).toBe(1)
  expect(
    await main(['maintainer', 'review', '--interactive', '--json'], runtime),
  ).toBe(1)
  expect(existsSync('.intent/review-state.json')).toBe(false)
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
    (step) => step.name === 'Check maintainer workflow',
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
    'maintainer\ncheck\n--base\nfixture-base\n',
  )
  rmSync('CLAUDE.md')
  rmSync('checked-args')
  mkdirSync('.intent')
  writeFileSync('.intent/review-state.json', '{}')
  execFileSync('bash', ['-c', script], options)
  expect(existsSync('checked-args')).toBe(true)
})
