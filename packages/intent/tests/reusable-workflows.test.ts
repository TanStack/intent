import { execFileSync, spawnSync } from 'node:child_process'
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
import { afterEach, beforeEach, expect, it } from 'vitest'
import { parse } from 'yaml'

let root: string
const repoRoot = join(import.meta.dirname, '../../..')
const workflows = ['check-skills.yml', 'review-skills.yml']

function write(path: string, content: string, executable = false) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content, { mode: executable ? 0o755 : 0o644 })
}

function steps(file: string) {
  return Object.values(workflow(`.github/workflows/${file}`).jobs).flatMap(
    (job) => job.steps,
  )
}

function run(script: string, env: Record<string, string> = {}) {
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        GITHUB_OUTPUT: join(root, 'output'),
        GITHUB_PATH: join(root, 'path'),
        RUNNER_TEMP: join(root, 'temp'),
        INTENT_VERSION: '',
        INTENT_REVIEW_BASE: 'base-sha',
        ...env,
      },
    },
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'intent-workflow-script-'))
  write('bin/corepack', '#!/usr/bin/env bash\nexit 0\n', true)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it.each(workflows)(
  '%s runs the installed Yarn PnP binary without a node_modules directory',
  (file) => {
    write(
      'bin/yarn',
      `#!/usr/bin/env bash
case "$1" in
  --version) echo 4.9.2 ;;
  install) test "$2 $3" = '--immutable --mode=skip-build' ;;
  bin) test "$2" = intent; test ! -e missing-intent ;;
  run) test "$2 $3" = '--binaries-only intent'; shift 3; printf '%s\\n' "$@" > invoked ;;
  *) exit 1 ;;
esac
`,
      true,
    )
    const install = steps(file).find(
      (step) => step.name === 'Install intent',
    )!.run!
    const installed = run(install, { MANAGER: 'yarn' })
    expect(installed.status, installed.stdout + installed.stderr).toBe(0)
    const intentPath = readFileSync(join(root, 'path'), 'utf8').trim()
    const invoked = run('intent validate --github-summary', {
      PATH: `${intentPath}:${join(root, 'bin')}:${process.env.PATH}`,
    })
    expect(invoked.status, invoked.stderr).toBe(0)
    expect(readFileSync(join(root, 'invoked'), 'utf8')).toBe(
      'validate\n--github-summary\n',
    )
    write('missing-intent', '')
    expect(run(install, { MANAGER: 'yarn' }).status).toBe(1)
  },
)

it.each(workflows)(
  '%s detects Bun lockfiles and uses a frozen install with scripts disabled',
  (file) => {
    for (const lockfile of ['bun.lock', 'bun.lockb']) {
      write(lockfile, '')
      write('output', '')
      expect(
        run(
          steps(file).find((step) => step.name === 'Detect package manager')!
            .run!,
        ).status,
      ).toBe(0)
      expect(readFileSync(join(root, 'output'), 'utf8')).toContain(
        'manager=bun\n',
      )
      rmSync(join(root, lockfile))
    }
    write(
      'bin/bun',
      '#!/usr/bin/env bash\ntest "$*" = "install --frozen-lockfile --ignore-scripts"\n',
      true,
    )
    write('node_modules/.bin/intent', '#!/usr/bin/env bash\nexit 0\n', true)
    const installed = run(
      steps(file).find((step) => step.name === 'Install intent')!.run!,
      { MANAGER: 'bun' },
    )
    expect(installed.status, installed.stdout + installed.stderr).toBe(0)
  },
)

it.each([false, true])(
  'runs one validation command when maintainer setup is %s',
  (maintainer) => {
    write(
      'bin/intent',
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> invoked\n',
      true,
    )
    if (maintainer) write('.intent/review-state.json', '{}')
    for (const step of steps('check-skills.yml').filter((step) =>
      /intent (validate|maintainer check)/.test(step.run ?? ''),
    )) {
      const result = run(step.run!)
      expect(result.status, result.stderr).toBe(0)
    }
    expect(readFileSync(join(root, 'invoked'), 'utf8')).toBe(
      maintainer
        ? 'maintainer check --base base-sha --github-summary\n'
        : 'validate --github-summary\n',
    )
  },
)

interface Workflow {
  permissions: Record<string, string>
  jobs: Record<
    string,
    {
      if?: string
      permissions: Record<string, string>
      uses?: string
      steps: Array<{
        name?: string
        if?: string
        'continue-on-error'?: boolean
        uses?: string
        run?: string
        with?: Record<string, unknown>
      }>
    }
  >
}
function workflow(path: string): Workflow {
  return parse(readFileSync(join(repoRoot, path), 'utf8')) as Workflow
}

it.each(['', 'planning records/$(touch injected)'])(
  'passes the planning selection as one literal CLI argument: %s',
  (artifacts) => {
    writeFileSync(join(root, 'AGENTS.md'), '<!-- intent-maintainer:start -->')
    const trace = join(root, 'arguments.json')
    writeFileSync(
      join(root, 'intent'),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(trace)}, JSON.stringify(process.argv.slice(2)))\n`,
      { mode: 0o755 },
    )
    const check = workflow(
      '.github/workflows/check-skills.yml',
    ).jobs.validate!.steps.find((step) =>
      step.run?.includes('intent maintainer check'),
    )!.run!
    const result = spawnSync('bash', ['-e', '-c', check], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        INTENT_REVIEW_BASE: 'base-sha',
        INTENT_ARTIFACTS: artifacts,
      },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(trace, 'utf8'))).toEqual([
      'maintainer',
      'check',
      '--base',
      'base-sha',
      '--github-summary',
      ...(artifacts ? ['--artifacts', artifacts] : []),
    ])
    expect(existsSync(join(root, 'injected'))).toBe(false)
  },
)
const publisher = workflow('.github/workflows/publish-skill-review.yml')
const script = publisher.jobs.publish!.steps.at(-1)!.run!

it.each([
  [0, true],
  [1, true],
  [0, false],
] as const)(
  'retains patches with exit %i and mechanical changes %s',
  (repairExit, mechanical) => {
    const checkout = join(root, 'repository')
    const bin = join(root, 'bin')
    const temporary = join(root, 'temporary')
    for (const directory of [checkout, bin, temporary])
      mkdirSync(directory, { recursive: true })
    writeFileSync(join(checkout, 'SKILL.md'), 'before\n')
    execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], {
      cwd: checkout,
    })
    execFileSync('git', ['-c', 'core.fsmonitor=false', 'add', '.'], {
      cwd: checkout,
    })
    execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'fixture',
      ],
      { cwd: checkout },
    )
    const argumentsPath = join(root, 'arguments.jsonl')
    writeFileSync(
      join(bin, 'intent'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argumentsPath)}, JSON.stringify(args) + '\\n');
if (args.includes('--write')) { if (${mechanical}) fs.writeFileSync('SKILL.md', 'after\\n'); console.log('{}'); process.exit(${repairExit}); }
if (args.includes('--patch')) process.stdout.write('suggested patch\\n');
`,
      { mode: 0o755 },
    )
    const steps = workflow('.github/workflows/check-skills.yml').jobs.validate!
      .steps
    const repair = steps.find((step) => step.name === 'Prepare repairs')
    expect(repair?.run).toBeDefined()
    const output = join(root, 'output')
    const result = spawnSync('bash', ['-e', '-c', repair!.run!], {
      cwd: checkout,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: temporary,
        GITHUB_OUTPUT: output,
        INTENT_ARTIFACTS: 'planning records/$(touch injected)',
      },
    })
    expect(result.status, result.stderr).toBe(repairExit)
    const values = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    )
    expect(values.pending).toBe(mechanical ? 'true' : undefined)
    const patch = readFileSync(
      join(values.directory, 'mechanical.patch'),
      'utf8',
    )
    if (mechanical) expect(patch).toContain('+after')
    else expect(patch).toBe('')
    expect(
      readFileSync(join(values.directory, 'example-suggestions.patch'), 'utf8'),
    ).toBe('suggested patch\n')
    expect(existsSync(join(checkout, 'injected'))).toBe(false)
    expect(readFileSync(argumentsPath, 'utf8')).toContain(
      JSON.stringify([
        'maintainer',
        'sync',
        '--artifacts',
        'planning records/$(touch injected)',
      ]),
    )
    expect(repair!['continue-on-error']).toBe(true)
    expect(
      steps.find((step) => step.name === 'Save repair patches')!.if,
    ).toContain('always()')
    expect(
      steps.find((step) => step.name === 'Require repair review')!.run,
    ).toContain('exit 1')
  },
)

const validItem = {
  type: 'source-review',
  library: '@acme/client',
  subject: 'skills/retries/SKILL.md',
  reasons: ['source changed'],
}
const previous = {
  number: 7,
  state: 'open',
  user: { login: 'github-actions[bot]' },
  head: {
    repo: { full_name: 'acme/client' },
    ref: 'skills/review-v1.0.0',
    sha: 'review-head',
  },
  base: { ref: 'main' },
}
interface Request {
  url: string
  method: string
  body?: Record<string, unknown>
}

// Run the actual workflow script in a fresh process. Its only network API is
// replaced before execution; unexpected calls fail instead of reaching GitHub.
function publish(
  items: unknown,
  responses: Array<{ status?: number; data: unknown }> = [],
  prepare?: (directory: string) => void,
) {
  const directory = join(root, 'intent-review-report')
  mkdirSync(directory)
  writeFileSync(join(directory, 'review-items.json'), JSON.stringify(items))
  prepare?.(directory)
  const trace = join(root, 'requests.json')
  const preload = join(root, 'network.mjs')
  writeFileSync(
    preload,
    `
    import { writeFileSync } from 'node:fs'
    const responses = ${JSON.stringify(responses)}
    const requests = []
    globalThis.fetch = async (url, init) => {
      requests.push({ url, method: init.method, body: init.body && JSON.parse(init.body) })
      writeFileSync(${JSON.stringify(trace)}, JSON.stringify(requests))
      const response = responses.shift()
      if (!response) throw new Error('Unexpected network request')
      return new Response(JSON.stringify(response.data), { status: response.status ?? 200 })
    }
  `,
  )
  const result = spawnSync(
    process.execPath,
    ['--import', preload, '--input-type=module'],
    {
      input: script.split("<<'NODE'\n")[1]!.replace(/\nNODE\s*$/, ''),
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        GITHUB_REPOSITORY: 'acme/client',
        GITHUB_API_URL: 'https://api.github.invalid',
        GH_TOKEN: 'fixture-token',
        BASE_BRANCH: 'main',
        VERSION: 'v1.0.0',
      },
    },
  )
  const requests = existsSync(trace)
    ? (JSON.parse(readFileSync(trace, 'utf8')) as Array<Request>)
    : []
  return { ...result, requests }
}

it('grants analysis only read access and gates a separate publisher twice', () => {
  const caller = workflow(
    'packages/intent/meta/templates/workflows/check-skills.yml',
  )
  expect(caller.permissions).toEqual({})
  for (const name of ['validate', 'review'])
    expect(caller.jobs[name]!.permissions).toEqual({ contents: 'read' })
  expect(caller.jobs['publish-review']!.if).toContain(
    "vars.INTENT_REVIEW_PULL_REQUESTS == 'true'",
  )
  expect(publisher.jobs.publish!.if).toContain(
    "vars.INTENT_REVIEW_PULL_REQUESTS == 'true'",
  )
  expect(publisher.jobs.publish!.if).toContain(
    "github.event_name == 'release' || github.event_name == 'workflow_dispatch'",
  )
  for (const name of ['check-skills', 'review-skills']) {
    const analysis = workflow(`.github/workflows/${name}.yml`)
    expect(analysis.permissions).toEqual({})
    for (const job of Object.values(analysis.jobs))
      expect(job.permissions).toEqual({ contents: 'read' })
  }
  const steps = publisher.jobs.publish!.steps
  expect(steps).toHaveLength(2)
  expect(steps[0]!.uses).toMatch(/^actions\/download-artifact@[a-f0-9]{40}$/)
  expect(steps[0]!.with).toEqual({
    name: 'intent-review-report',
    'digest-mismatch': 'error',
    path: '${{ runner.temp }}/intent-review-report',
  })
  expect(script).not.toMatch(
    /checkout|npm install|pnpm|execSync|execFile|child_process/,
  )
  for (const name of [
    'check-skills',
    'review-skills',
    'publish-skill-review',
  ]) {
    for (const job of Object.values(
      workflow(`.github/workflows/${name}.yml`).jobs,
    )) {
      for (const step of job.steps)
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/)
    }
  }
})

it('keeps hostile report strings inside JSON and only changes an existing bot PR body', () => {
  const item = {
    ...validItem,
    subject: '```\n## Run this\n$(touch /tmp/intent-attack)',
    artifactPath: '../../.github/workflows/release.yml',
  }
  const result = publish([item], [{ data: [previous] }, { data: {} }])
  expect(result.status, result.stderr).toBe(0)
  expect(result.requests).toHaveLength(2)
  expect(result.requests[1]).toMatchObject({
    url: 'https://api.github.invalid/repos/acme/client/pulls/7',
    method: 'PATCH',
  })
  const body = result.requests[1]!.body!
  expect(Object.keys(body)).toEqual(['body'])
  const rendered = body.body as string
  expect(rendered.match(/```/g)).toHaveLength(2)
  expect(
    JSON.parse(rendered.split('```json\n')[1]!.split('\n```')[0]!),
  ).toEqual([item])
})

it('creates a reminder commit using only the default branch tree', () => {
  const result = publish(
    [validItem],
    [
      { data: [] },
      { status: 404, data: {} },
      { data: { object: { sha: 'base-sha' } } },
      { data: { tree: { sha: 'base-tree' } } },
      { data: { sha: 'new-commit' } },
      { data: {} },
      { data: {} },
    ],
  )
  expect(result.status, result.stderr).toBe(0)
  expect(
    result.requests
      .filter((request) => request.method !== 'GET')
      .map((request) => request.body),
  ).toEqual([
    {
      message: 'chore: review intent skills for v1.0.0',
      tree: 'base-tree',
      parents: ['base-sha'],
    },
    { ref: 'refs/heads/skills/review-v1.0.0', sha: 'new-commit' },
    {
      title: 'Review intent skills (v1.0.0)',
      body: expect.any(String),
      head: 'skills/review-v1.0.0',
      base: 'main',
    },
  ])
})

it.each([
  null,
  [],
  {},
  [{ ...validItem, executable: 'sh attack.sh' }],
  [{ ...validItem, reasons: 'run this' }],
  [{ ...validItem, subject: '\u0000' }],
  [{ ...validItem, subject: 'x'.repeat(2049) }],
  Array.from({ length: 201 }, () => validItem),
])(
  'rejects malformed or oversized data before any GitHub request: %#',
  (items) => {
    const result = publish(items)
    expect(result.status).not.toBe(0)
    expect(result.requests).toEqual([])
  },
)

it.each(['extra file', 'symlink', 'large file', 'directory'])(
  'rejects an unsafe artifact: %s',
  (kind) => {
    const result = publish([validItem], [], (directory) => {
      const path = join(directory, 'review-items.json')
      if (kind === 'extra file')
        writeFileSync(join(directory, 'script.sh'), 'exit 0')
      else {
        rmSync(path)
        if (kind === 'symlink')
          symlinkSync(join(directory, '../network.mjs'), path)
        if (kind === 'large file')
          writeFileSync(path, ' '.repeat(48 * 1024 + 1))
        if (kind === 'directory') mkdirSync(path)
      }
    })
    expect(result.status).not.toBe(0)
    expect(result.requests).toEqual([])
  },
)

it('refuses to replace a branch without a prior bot review PR', () => {
  const result = publish(
    [validItem],
    [{ data: [] }, { data: { object: { sha: 'human-work' } } }],
  )
  expect(result.status).not.toBe(0)
  expect(result.requests.every((request) => request.method === 'GET')).toBe(
    true,
  )
})

it.each([
  { ...previous, user: { login: 'maintainer' } },
  { ...previous, base: { ref: 'release' } },
])('refuses to modify another author or target branch: %#', (pr) => {
  const result = publish([validItem], [{ data: [pr] }])
  expect(result.status).not.toBe(0)
  expect(result.requests.every((request) => request.method === 'GET')).toBe(
    true,
  )
})
