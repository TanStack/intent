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
import { main } from '../../src/cli.js'
import { listIntentSkills, loadIntentSkill } from '../../src/core/index.js'
import { buildCurrentLockfileSources } from '../../src/core/lockfile/lockfile-state.js'
import { parseSkillSources } from '../../src/core/skill-sources.js'
import { applySourcePolicy } from '../../src/core/source-policy.js'

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
  let previousIntentAudience: string | undefined
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    originalCwd = process.cwd()
    previousIntentAudience = process.env.INTENT_AUDIENCE
    delete process.env.INTENT_AUDIENCE
    root = mkdtempSync(join(realTmpdir, 'intent-g4-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
    delete process.env.INTENT_GLOBAL_NODE_MODULES
    if (previousIntentAudience === undefined) {
      delete process.env.INTENT_AUDIENCE
    } else {
      process.env.INTENT_AUDIENCE = previousIntentAudience
    }
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

  it('list names the unlisted package for a human audience', () => {
    writeStandaloneFixture()

    const result = listIntentSkills({ cwd: root, audience: 'human' })

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

  it('list withholds the unlisted package name from an agent audience', () => {
    writeStandaloneFixture()

    const result = listIntentSkills({ cwd: root, audience: 'agent' })

    expect(result.packages.map((pkg) => pkg.name)).toEqual([LISTED])
    expect(result.notices.some((notice) => notice.includes(UNLISTED))).toBe(
      false,
    )
    expect(
      result.notices.some((notice) =>
        notice.includes('not listed in intent.skills'),
      ),
    ).toBe(true)
  })

  it.each([
    ['one skill', '@scope/hidden-one', ['only'], '1 skill'],
    ['multiple skills', '@scope/hidden-many', ['first', 'second'], '2 skills'],
  ])(
    'list --show-hidden prints a fully unlisted package with %s',
    async (_case, hiddenPackage, hiddenSkills, count) => {
      writeJson(join(root, 'package.json'), {
        name: 'app',
        private: true,
        intent: { skills: [LISTED] },
      })
      writeIntentPackage(root, LISTED, 'core')
      for (const hiddenSkill of hiddenSkills) {
        writeIntentPackage(root, hiddenPackage, hiddenSkill)
      }
      process.env.INTENT_AUDIENCE = 'human'
      process.chdir(root)

      const exitCode = await main(['list', '--show-hidden'])
      const output = logSpy.mock.calls.flat().join('\n')

      expect(exitCode).toBe(0)
      expect(output).toContain(`  ${hiddenPackage} (${count})`)
    },
  )

  it('list --show-hidden names skills hidden by a skill-level entry', async () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: [`${LISTED}#a`] },
    })
    writeIntentPackage(root, LISTED, 'a')
    writeIntentPackage(root, LISTED, 'b')
    writeIntentPackage(root, LISTED, 'c')
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list', '--show-hidden'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(`  ${LISTED} (2 skills not listed: b, c)`)
  })

  it('list --show-hidden redacts hidden source details for an agent audience', async () => {
    const hiddenPackage = '@scope/agent-secret-package'
    const hiddenSkill = 'agent-secret-skill'
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: [LISTED] },
    })
    writeIntentPackage(root, LISTED, 'core')
    writeIntentPackage(root, hiddenPackage, hiddenSkill)
    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    const exitCode = await main(['list', '--show-hidden'])
    const output = [
      ...logSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ].join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      'Hidden skill sources are not revealed in agent sessions. Run this command outside the agent session to review candidates.',
    )
    expect(output).not.toContain(hiddenPackage)
    expect(output).not.toContain(hiddenSkill)
  })

  it('documents the current empty source retained for an unmatched skill entry', () => {
    const packageName = '@scope/empty-source'
    const packageRoot = join(root, 'node_modules', '@scope', 'empty-source')
    const skillPath = join(packageRoot, 'skills', 'b', 'SKILL.md')
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: [`${packageName}#a`] },
    })
    writeIntentPackage(root, packageName, 'b')

    const listed = listIntentSkills({ cwd: root, audience: 'human' })
    const policy = applySourcePolicy(
      {
        packages: [
          {
            name: packageName,
            version: '1.0.0',
            intent: { version: 1, repo: 'owner/repo', docs: 'docs/' },
            skills: [
              {
                name: 'b',
                path: skillPath,
                description: `${packageName} b`,
              },
            ],
            packageRoot,
            kind: 'npm',
            source: 'local',
          },
        ],
      },
      {
        config: parseSkillSources([`${packageName}#a`]),
        excludeMatchers: [],
      },
    )
    const notices = [
      `1 skill from listed packages is not listed in intent.skills: ${packageName}#b. Add to opt in.`,
      `"${packageName}#a" is declared in intent.skills but was not discovered.`,
    ]

    expect(listed.packages).toMatchObject([
      { name: packageName, skillCount: 0 },
    ])
    expect(listed.notices).toEqual(notices)
    expect(policy).toMatchObject({
      hiddenSourceCount: 1,
      hiddenSources: [
        { name: packageName, skillCount: 1, hiddenSkills: ['b'] },
      ],
      packages: [{ name: packageName, skills: [] }],
      notices,
    })
    expect(buildCurrentLockfileSources(policy.packages)).toEqual([
      { kind: 'npm', id: packageName, skills: [] },
    ])
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

  it('install --map reports static catalogue guidance without source names', async () => {
    writeStandaloneFixture()
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-g4-global-'),
    )
    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      'Would write Intent catalog guidance to AGENTS.md.',
    )
    expect(output).toContain('No files changed.')
    expect(output).not.toContain(LISTED)
    expect(output).not.toContain(UNLISTED)
    expect(output).not.toContain(EXCLUDED)

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
