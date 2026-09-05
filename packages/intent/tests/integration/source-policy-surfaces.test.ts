import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listIntentSkills, loadIntentSkill } from '../../src/core/index.js'
import { main } from '../../src/cli.js'
import { buildHookRunnerScript } from '../../src/hooks/install.js'

const realTmpdir = realpathSync(tmpdir())

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeIntentPackage(
  baseDir: string,
  name: string,
  skillNames: string | Array<string>,
): void {
  const pkgDir = join(baseDir, 'node_modules', ...name.split('/'))
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: 'owner/repo', docs: 'docs/' },
  })
  for (const skillName of Array.isArray(skillNames)
    ? skillNames
    : [skillNames]) {
    mkdirSync(join(pkgDir, 'skills', skillName), { recursive: true })
    writeFileSync(
      join(pkgDir, 'skills', skillName, 'SKILL.md'),
      `---\nname: "${skillName}"\ndescription: "${name} ${skillName}"\nlibrary_version: "1.0.0"\n---\n\nContent.\n`,
    )
  }
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

  it.each([
    ['list', '--json'],
    ['load', `${LISTED}#core`],
    ['load', `${LISTED}#core`, '--json'],
    ['load', `${LISTED}#core`, '--path'],
    ['install'],
    ['install', '--map'],
  ])(
    'fails without delivering skills for malformed policy: %j',
    async (...args) => {
      writeStandaloneFixture()
      const packageJsonPath = join(root, 'package.json')
      writeFileSync(packageJsonPath, '{"intent":{"skills":[]},')
      process.env.INTENT_GLOBAL_NODE_MODULES = join(root, 'empty-global')
      process.chdir(root)
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)

      const exitCode = await main(args)

      expect(exitCode).toBe(1)
      expect(logSpy).not.toHaveBeenCalled()
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(packageJsonPath),
      )
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    },
  )

  it('list surfaces only the listed package', () => {
    writeStandaloneFixture()

    const result = listIntentSkills({ audience: 'human', cwd: root })

    expect(result.packages.map((pkg) => pkg.name)).toEqual([LISTED])
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

  it.each([
    ['list', '--json'],
    ['load', `${LISTED}#core`],
    ['load', `${LISTED}#core`, '--json'],
    ['load', `${LISTED}#core`, '--path'],
    ['install'],
    ['install', '--map'],
  ])('rejects a malformed npm workspace ancestor for %j', async (...args) => {
    const appDir = join(root, 'packages', 'app')
    const manifest = join(root, 'package.json')
    writeFileSync(
      manifest,
      `{"workspaces":["packages/*"],"intent":{"exclude":["${LISTED}"]},`,
    )
    writeJson(join(appDir, 'package.json'), {
      name: 'app',
      intent: { skills: [LISTED] },
    })
    writeIntentPackage(appDir, LISTED, 'core')
    process.chdir(appDir)
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    expect(await main(args)).toBe(1)
    expect(logSpy).not.toHaveBeenCalled()
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(manifest),
    )
    expect(existsSync(join(appDir, 'AGENTS.md'))).toBe(false)
  })

  it('list and load accept packages matched by an allowlist glob', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@scope/*'] },
    })
    writeIntentPackage(root, LISTED, 'core')
    writeIntentPackage(root, UNLISTED, 'core')
    writeIntentPackage(root, '@other/hidden', 'core')

    const listed = listIntentSkills({ cwd: root })

    expect(listed.packages.map((pkg) => pkg.name)).toEqual([LISTED, UNLISTED])
    expect(loadIntentSkill(`${UNLISTED}#core`, { cwd: root }).packageName).toBe(
      UNLISTED,
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

  it('applies an exact selector across list, load, install map, stale, and hook catalogs', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
      workspaces: ['packages/*'],
      intent: { skills: [`${LISTED}#allowed`] },
    })
    writeJson(join(root, 'packages', 'app', 'package.json'), {
      name: '@scope/app',
    })
    writeIntentPackage(root, LISTED, ['allowed', 'hidden'])
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-g4-global-'),
    )
    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot

    const listed = listIntentSkills({ cwd: root })
    expect(listed.skills.map((entry) => entry.use)).toEqual([
      `${LISTED}#allowed`,
    ])
    expect(loadIntentSkill(`${LISTED}#allowed`, { cwd: root }).skillName).toBe(
      'allowed',
    )
    expect(() => loadIntentSkill(`${LISTED}#hidden`, { cwd: root })).toThrow(
      'is not listed in intent.skills',
    )

    process.chdir(root)
    expect(await main(['install', '--map', '--dry-run'])).toBe(0)
    const installOutput = logSpy.mock.calls.flat().join('\n')
    expect(installOutput).toContain(`id: "${LISTED}#allowed"`)
    expect(installOutput).not.toContain(`id: "${LISTED}#hidden"`)

    const catalogPath = join(root, 'catalog.mjs')
    const hookPath = join(root, 'intent-hook.mjs')
    writeFileSync(
      catalogPath,
      `console.log(${JSON.stringify(JSON.stringify(listed))})\n`,
    )
    writeFileSync(
      hookPath,
      buildHookRunnerScript(
        'claude',
        `${JSON.stringify(process.execPath)} ${JSON.stringify(catalogPath)}`,
      ),
    )
    const hookResult = spawnSync(process.execPath, [hookPath], {
      encoding: 'utf8',
      input: JSON.stringify({
        cwd: root,
        hook_event_name: 'SessionStart',
        session_id: 'exact-selector',
      }),
    })
    const hookContext = JSON.parse(hookResult.stdout).hookSpecificOutput
      .additionalContext as string
    expect(hookContext).toContain(`${LISTED}#allowed`)
    expect(hookContext).not.toContain(`${LISTED}#hidden`)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '2.0.0' }),
    } as Response)
    expect(await main(['stale', '--json'])).toBe(0)
    const staleOutput = String(logSpy.mock.calls.at(-1)?.[0])
    const reports = JSON.parse(staleOutput) as Array<{ library: string }>
    expect(reports.map((report) => report.library)).toEqual([LISTED])
    expect(staleOutput).not.toContain('hidden')

    fetchSpy.mockRestore()
    rmSync(isolatedGlobalRoot, { recursive: true, force: true })
  })
})
