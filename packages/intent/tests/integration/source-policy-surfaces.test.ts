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
import {
  IntentCoreError,
  listIntentSkills,
  loadIntentSkill,
} from '../../src/core/index.js'
import { main } from '../../src/cli.js'

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

  function writeExactSkillFixture(excludeSelected = false): void {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        skills: [`${LISTED}#selected`],
        ...(excludeSelected ? { exclude: [`${LISTED}#selected`] } : {}),
      },
    })
    writeIntentPackage(root, LISTED, 'selected')
    writeIntentPackage(root, LISTED, 'sibling')
  }

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

  it('list returns only the exact selected skill', () => {
    writeExactSkillFixture()

    const result = listIntentSkills({ audience: 'human', cwd: root })

    expect(result.packages.map((pkg) => pkg.name)).toEqual([LISTED])
    expect(result.skills.map((skill) => skill.use)).toEqual([
      `${LISTED}#selected`,
    ])
  })

  it('install --map --dry-run includes only the exact selected skill', async () => {
    writeExactSkillFixture()
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-exact-global-'),
    )
    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(`id: "${LISTED}#selected"`)
    expect(output).not.toContain(`id: "${LISTED}#sibling"`)

    rmSync(isolatedGlobalRoot, { recursive: true, force: true })
  })

  it('load permits the exact selected skill and refuses its sibling', () => {
    writeExactSkillFixture()

    expect(loadIntentSkill(`${LISTED}#selected`, { cwd: root }).skillName).toBe(
      'selected',
    )

    let thrown: unknown
    try {
      loadIntentSkill(`${LISTED}#sibling`, { cwd: root })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(IntentCoreError)
    expect((thrown as IntentCoreError).code).toBe('skill-not-listed')
  })

  it('a matching exclude wins and omits the selected skill from list and map', async () => {
    writeExactSkillFixture(true)
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-excluded-skill-global-'),
    )
    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const listed = listIntentSkills({ cwd: root })
    let thrown: unknown
    try {
      loadIntentSkill(`${LISTED}#selected`, { cwd: root })
    } catch (error) {
      thrown = error
    }
    const exitCode = await main(['install', '--map', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(listed.skills).toEqual([])
    expect(thrown).toBeInstanceOf(IntentCoreError)
    expect((thrown as IntentCoreError).code).toBe('skill-excluded')
    expect(exitCode).toBe(0)
    expect(output).not.toContain(`id: "${LISTED}#selected"`)

    rmSync(isolatedGlobalRoot, { recursive: true, force: true })
  })
})
