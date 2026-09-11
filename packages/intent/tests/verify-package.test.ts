import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'

let root: string
let previousCwd: string

function write(path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function pack(files: Array<string>, packageDirectory = ''): string {
  const staging = join(root, 'archive/package')
  mkdirSync(staging, { recursive: true })
  for (const file of files) {
    mkdirSync(dirname(join(staging, file)), { recursive: true })
    cpSync(join(root, packageDirectory, file), join(staging, file), {
      recursive: true,
    })
  }
  const archive = join(root, 'library.tgz')
  execFileSync('tar', ['-czf', archive, '-C', dirname(staging), 'package'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  return archive
}

beforeEach(() => {
  previousCwd = process.cwd()
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-verify-package-')))
  process.chdir(root)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'])
  write('package.json', '{"name":"library","version":"1.0.0"}\n')
  write(
    'skills/_artifacts/skill_tree.yaml',
    'skills:\n  - name: core\n    path: skills/core/SKILL.md\n',
  )
  write(
    'skills/core/SKILL.md',
    '---\nname: core\ndescription: Core task\nsources: [src/private.ts]\n---\nRead [the example](references/example.md#usage) and run [the helper](scripts/check.mjs).\n\n```md\n[Illustration](not-a-resource.md)\n```\n',
  )
  write('skills/core/references/example.md', '# Usage\n\nRead the value.\n')
  write('skills/core/scripts/check.mjs', 'throw new Error("Do not execute")\n')
})

afterEach(() => {
  process.chdir(previousCwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

it('verifies packaged skills and resources in CI without extracting or running them', async () => {
  const archive = pack(['package.json', 'skills/core'])
  const original = readFileSync(archive)
  expect(
    await main(['maintainer', 'verify-package', archive, '--json'], {
      isTTY: true,
      isCI: true,
    }),
  ).toBe(0)
  const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(report).toMatchObject({
    valid: true,
    package: { name: 'library', version: '1.0.0' },
    skills: ['skills/core/SKILL.md'],
    problems: [],
  })
  expect(readFileSync(archive)).toEqual(original)
  expect(existsSync(join(root, '.intent'))).toBe(false)
  expect(existsSync(join(root, 'package'))).toBe(false)
})

it('reports a missing packaged reference and fails the CI check', async () => {
  const archive = pack([
    'package.json',
    'skills/core/SKILL.md',
    'skills/core/scripts/check.mjs',
  ])
  expect(await main(['maintainer', 'verify-package', archive, '--json'])).toBe(
    1,
  )
  const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(report.valid).toBe(false)
  expect(report.problems).toContainEqual(
    expect.objectContaining({
      file: 'skills/core/SKILL.md',
      target: 'skills/core/references/example.md',
    }),
  )
})

it('requires skill-folder resources even when instructions do not link them', async () => {
  write('skills/core/scripts/extra.mjs', 'export const required = true\n')
  const archive = pack([
    'package.json',
    'skills/core/SKILL.md',
    'skills/core/references',
    'skills/core/scripts/check.mjs',
  ])
  expect(await main(['maintainer', 'verify-package', archive, '--json'])).toBe(
    1,
  )
  const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(report.problems).toContainEqual(
    expect.objectContaining({ target: 'skills/core/scripts/extra.mjs' }),
  )
})

it('checks nested references without looping and rejects package escapes', async () => {
  write(
    'skills/core/references/example.md',
    '[Back](../SKILL.md)\n[Missing](missing.md)\n[Outside](../../../../outside.md)\n',
  )
  const archive = pack(['package.json', 'skills/core'])
  expect(await main(['maintainer', 'verify-package', archive, '--json'])).toBe(
    1,
  )
  const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(report.problems).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ target: 'skills/core/references/missing.md' }),
      expect.objectContaining({ target: '../../../../outside.md' }),
    ]),
  )
})

it.each(['missing skill', 'wrong package', 'wrong version', 'corrupt archive'])(
  'fails for %s with structured output',
  async (failure) => {
    const archive = pack(
      failure === 'missing skill'
        ? ['package.json']
        : ['package.json', 'skills/core'],
    )
    if (failure === 'wrong package')
      write('package.json', '{"name":"another","version":"1.0.0"}\n')
    if (failure === 'wrong version')
      write('package.json', '{"name":"library","version":"2.0.0"}\n')
    if (failure === 'corrupt archive') writeFileSync(archive, 'not gzip or tar')
    expect(
      await main(['maintainer', 'verify-package', archive, '--json']),
    ).toBe(1)
    const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
    expect(report.valid).toBe(false)
    expect(report.problems.length).toBeGreaterThan(0)
    expect(existsSync(join(root, '.intent'))).toBe(false)
  },
)

it('rejects archive symbolic links without following them', async () => {
  symlinkSync(join(root, 'package.json'), join(root, 'skills/core/linked.json'))
  const archive = pack(['package.json', 'skills/core'])
  expect(await main(['maintainer', 'verify-package', archive, '--json'])).toBe(
    1,
  )
  const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(report.problems[0].message).toContain('Unsupported archive entry')
})

it('verifies a real npm archive without requiring provenance files', async () => {
  write(
    'package.json',
    JSON.stringify({
      name: 'library',
      version: '1.0.0',
      files: ['skills/core'],
      scripts: { prepack: 'node -e "process.exit(1)"' },
    }),
  )
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, npm_config_cache: join(root, 'npm-cache') },
    }),
  )
  expect(
    await main(['maintainer', 'verify-package', packed[0].filename, '--json']),
  ).toBe(0)
  expect(existsSync(join(root, 'src/private.ts'))).toBe(false)
  expect(existsSync(join(root, '.intent'))).toBe(false)
}, 30_000)

it('checks only the selected workspace package and its active registrations', async () => {
  write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
  write(
    'packages/client/package.json',
    '{"name":"@library/client","version":"2.0.0"}\n',
  )
  write(
    'packages/client/skills/query/SKILL.md',
    '---\nname: query\ndescription: Query\n---\nRead [the reference](references/query.md).\n',
  )
  write('packages/client/skills/query/references/query.md', 'Query example.\n')
  write(
    'skills/_artifacts/skill_tree.yaml',
    'skills:\n  - name: query\n    package: packages/client\n    path: skills/query/SKILL.md\n  - name: future\n    package: packages/client\n    path: skills/future/SKILL.md\n    status: planned\n  - name: old\n    package: packages/client\n    path: skills/old/SKILL.md\n    status: retired\n  - name: other\n    package: packages/other\n    path: skills/other/SKILL.md\n',
  )
  const archive = pack(['package.json', 'skills/query'], 'packages/client')
  expect(
    await main([
      'maintainer',
      'verify-package',
      archive,
      '--package',
      'packages/client',
      '--json',
    ]),
  ).toBe(0)
  const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]![0]))
  expect(report.skills).toEqual(['skills/query/SKILL.md'])
  expect(report.package.name).toBe('@library/client')
})
