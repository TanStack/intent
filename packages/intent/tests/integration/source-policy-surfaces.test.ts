import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listIntentSkills, loadIntentSkill } from '../../src/core/index.js'
import { main } from '../../src/cli.js'
import { readIntentLockfile } from '../../src/core/lockfile/lockfile.js'
import { scanForPolicedIntents } from '../../src/core/source-policy.js'
import { scanForIntents } from '../../src/discovery/scanner.js'

const realTmpdir = realpathSync(tmpdir())

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeIntentPackage(
  baseDir: string,
  name: string,
  skillName: string,
): void {
  const pkgDir = join(baseDir, 'node_modules', ...name.split('/'))
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: 'owner/repo', docs: 'docs/' },
  })
  mkdirSync(join(pkgDir, 'skills', skillName), { recursive: true })
  writeFileSync(
    join(pkgDir, 'skills', skillName, 'SKILL.md'),
    `---\nname: "${skillName}"\ndescription: "${name} ${skillName}"\n---\n\nContent.\n`,
  )
}

function writeWorkspaceIntentPackage(
  baseDir: string,
  name: string,
  skillName: string,
): void {
  const pkgDir = join(baseDir, 'packages', name)
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: 'owner/repo', docs: 'docs/' },
  })
  mkdirSync(join(pkgDir, 'skills', skillName), { recursive: true })
  writeFileSync(
    join(pkgDir, 'skills', skillName, 'SKILL.md'),
    `---\nname: "${skillName}"\ndescription: "${name} ${skillName}"\n---\n\nContent.\n`,
  )
}

function sourceKeys(
  packages: Array<{ kind: 'npm' | 'workspace'; name: string }>,
): Array<string> {
  return packages.map((pkg) => `${pkg.kind}:${pkg.name}`).sort()
}

const LISTED = '@scope/listed'
const UNLISTED = '@scope/unlisted'
const EXCLUDED = '@scope/excluded'

describe('source policy — all four surfaces filter excluded and unlisted', () => {
  let root: string
  let originalCwd: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    originalCwd = process.cwd()
    root = mkdtempSync(join(realTmpdir, 'intent-g4-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
    delete process.env.INTENT_GLOBAL_NODE_MODULES
    rmSync(root, { recursive: true, force: true })
  })

  function writeStandaloneFixture(): void {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: [LISTED], exclude: [EXCLUDED] },
    })
    writeIntentPackage(root, LISTED, 'core')
    writeIntentPackage(root, UNLISTED, 'core')
    writeIntentPackage(root, EXCLUDED, 'core')
  }

  it('list surfaces only the listed package', () => {
    writeStandaloneFixture()

    const result = listIntentSkills({ cwd: root, audience: 'human' })

    expect(result.packages.map((pkg) => pkg.name)).toEqual([LISTED])
    expect(result.hiddenSourceCount).toBe(1)
    expect(result.notices.some((notice) => notice.includes(UNLISTED))).toBe(
      true,
    )
    expect(result.notices.some((notice) => notice.includes(EXCLUDED))).toBe(
      false,
    )
    expect(result.warnings.some((warning) => warning.includes(UNLISTED))).toBe(
      false,
    )
  })

  it('load refuses the unlisted and excluded packages but allows the listed one', () => {
    writeStandaloneFixture()

    expect(() => loadIntentSkill(`${UNLISTED}#core`, { cwd: root })).toThrow(
      `package "${UNLISTED}" is not listed in intent.skills`,
    )
    expect(() => loadIntentSkill(`${EXCLUDED}#core`, { cwd: root })).toThrow(
      `package "${EXCLUDED}" is excluded by Intent configuration`,
    )
    expect(loadIntentSkill(`${LISTED}#core`, { cwd: root }).packageName).toBe(
      LISTED,
    )
  })

  it('install --map writes only the listed package into the block', async () => {
    writeStandaloneFixture()
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-g4-global-'),
    )
    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(`id: "${LISTED}#core"`)
    expect(output).not.toContain(`id: "${UNLISTED}#core"`)
    expect(output).not.toContain(`id: "${EXCLUDED}#core"`)

    rmSync(isolatedGlobalRoot, { recursive: true, force: true })
  })

  it('stale (discovered-dependency fallback) reports only the listed package', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
      workspaces: ['packages/*'],
      intent: { skills: [LISTED], exclude: [EXCLUDED] },
    })
    writeJson(join(root, 'packages', 'app', 'package.json'), {
      name: '@scope/app',
    })
    writeIntentPackage(root, LISTED, 'core')
    writeIntentPackage(root, UNLISTED, 'core')
    writeIntentPackage(root, EXCLUDED, 'core')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)
    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports.map((report) => report.library)).toEqual([LISTED])

    fetchSpy.mockRestore()
  })
})

describe('source identity lifecycle', () => {
  let root: string
  let originalCwd: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    originalCwd = process.cwd()
    root = mkdtempSync(join(realTmpdir, 'intent-source-identity-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function writeRootConfig(intent: Record<string, unknown>): void {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      workspaces: ['packages/*'],
      intent,
    })
  }

  it('preserves same-name sources through policy, locking, diffing, and frozen checks', async () => {
    writeRootConfig({ skills: ['workspace:foo'] })
    writeWorkspaceIntentPackage(root, 'foo', 'workspace')
    writeIntentPackage(root, 'foo', 'npm')

    expect(sourceKeys(scanForIntents(root).packages)).toEqual([
      'npm:foo',
      'workspace:foo',
    ])

    let policed = scanForPolicedIntents({
      cwd: root,
      scanOptions: {},
      coreOptions: { cwd: root },
    })
    expect(sourceKeys(policed.scan.packages)).toEqual(['workspace:foo'])
    expect(policed.hiddenSourceCount).toBe(1)

    writeRootConfig({
      skills: ['foo', 'workspace:foo'],
      exclude: ['foo#workspace'],
    })
    policed = scanForPolicedIntents({
      cwd: root,
      scanOptions: {},
      coreOptions: { cwd: root },
    })
    expect(sourceKeys(policed.scan.packages)).toEqual([
      'npm:foo',
      'workspace:foo',
    ])
    expect(
      policed.scan.packages.find((pkg) => pkg.kind === 'npm')?.skills,
    ).toHaveLength(1)
    expect(
      policed.scan.packages.find((pkg) => pkg.kind === 'workspace')?.skills,
    ).toEqual([])

    writeRootConfig({ skills: ['foo', 'workspace:foo'] })
    process.chdir(root)
    const approveExitCode = await main(['skills', 'approve', '--all'])
    expect(errorSpy).not.toHaveBeenCalled()
    expect(approveExitCode).toBe(0)

    const locked = readIntentLockfile(join(root, 'intent.lock'))
    expect(locked.status).toBe('found')
    if (locked.status !== 'found') return
    expect(
      locked.lockfile.sources
        .map((source) => `${source.kind}:${source.id}`)
        .sort(),
    ).toEqual(['npm:foo', 'workspace:foo'])

    writeFileSync(
      join(root, 'packages', 'foo', 'skills', 'workspace', 'SKILL.md'),
      'workspace drift',
    )
    logSpy.mockClear()
    expect(await main(['skills', 'diff', '--json'])).toBe(0)
    const diff = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      changed: Array<{ kind: string; id: string }>
    }
    expect(
      diff.changed.map((change) => ({ kind: change.kind, id: change.id })),
    ).toEqual([{ kind: 'workspace', id: 'foo' }])

    errorSpy.mockClear()
    expect(await main(['skills', 'approve', 'foo', '--yes'])).not.toBe(0)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ambiguous source "foo"'),
    )

    expect(await main(['skills', 'approve', 'workspace:foo', '--yes'])).toBe(0)

    writeFileSync(
      join(root, 'node_modules', 'foo', 'skills', 'npm', 'SKILL.md'),
      'npm drift',
    )
    errorSpy.mockClear()
    expect(await main(['skills', 'diff', '--frozen'])).toBe(2)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('intent.lock is out of date'),
    )
  })
})
