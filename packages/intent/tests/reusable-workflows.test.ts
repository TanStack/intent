import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

function steps(file: string): Array<{ name: string; run?: string }> {
  const workflow = parse(
    readFileSync(join(repoRoot, '.github/workflows', file), 'utf8'),
  )
  return Object.values(workflow.jobs).flatMap((job: any) => job.steps)
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
