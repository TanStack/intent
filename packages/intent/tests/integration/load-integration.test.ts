import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  canSymlink,
  isPackageManagerAvailable,
  publishFixtures,
  runLoad,
  scaffoldProject,
  startRegistry,
} from './scaffold.js'
import type { PackageManager, Registry } from './scaffold.js'

const PACKAGE_MANAGERS: Array<PackageManager> = ['npm', 'pnpm', 'yarn', 'bun']
const SKILL_USE = '@test-intent/skills-leaf#core'

let registry: Registry | undefined
const tempDirs: Array<string> = []

beforeAll(async () => {
  registry = await startRegistry()
  publishFixtures(registry.url)
}, 60_000)

afterAll(async () => {
  await registry?.stop()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function expectSkillContent(stdout: string): void {
  expect(stdout).toContain('# Core Skill')
  expect(stdout).toContain('This is a test skill used by integration tests.')
  expect(stdout).not.toMatch(/^TanStack Intent\b/m)
  expect(stdout).not.toMatch(/^Usage:/m)
}

describe.each(PACKAGE_MANAGERS)('intent load via installed bin (%s)', (pm) => {
  it.skipIf(!isPackageManagerAvailable(pm))(
    'prints the resolved skill content',
    () => {
      const { root, cwd } = scaffoldProject({
        pm,
        structure: 'single',
        dependency: '@test-intent/skills-leaf',
        registryUrl: registry!.url,
      })
      tempDirs.push(root)

      const result = runLoad(cwd, SKILL_USE)

      expect(result.exitCode, result.stderr).toBe(0)
      expectSkillContent(result.stdout)
    },
    60_000,
  )
})

describe('intent load resolution variants', () => {
  it('returns the resolved path with --path', () => {
    const { root, cwd } = scaffoldProject({
      pm: 'npm',
      structure: 'single',
      dependency: '@test-intent/skills-leaf',
      registryUrl: registry!.url,
    })
    tempDirs.push(root)

    const result = runLoad(cwd, SKILL_USE, { path: true })

    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout.trim()).toMatch(/skills[/\\]core[/\\]SKILL\.md\s*$/)
  }, 60_000)

  it('returns structured JSON with --json', () => {
    const { root, cwd } = scaffoldProject({
      pm: 'npm',
      structure: 'single',
      dependency: '@test-intent/skills-leaf',
      registryUrl: registry!.url,
    })
    tempDirs.push(root)

    const result = runLoad(cwd, SKILL_USE, { json: true })

    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.parsed).toMatchObject({
      package: '@test-intent/skills-leaf',
      skill: 'core',
      version: '1.0.0',
      content: expect.stringContaining('# Core Skill'),
    })
  }, 60_000)

  it.skipIf(!canSymlink())(
    'prints content when invoked through a symlink (mimics node_modules/.bin)',
    () => {
      const { root, cwd } = scaffoldProject({
        pm: 'npm',
        structure: 'single',
        dependency: '@test-intent/skills-leaf',
        registryUrl: registry!.url,
      })
      tempDirs.push(root)

      const result = runLoad(cwd, SKILL_USE, { method: 'symlink' })

      expect(result.exitCode, result.stderr).toBe(0)
      expectSkillContent(result.stdout)
    },
    60_000,
  )

  it('resolves a workspace-dep skill from a monorepo workspace package', () => {
    const { root, cwd } = scaffoldProject({
      pm: 'pnpm',
      structure: 'monorepo-workspace',
      dependency: '@test-intent/skills-leaf',
      registryUrl: registry!.url,
    })
    tempDirs.push(root)

    const result = runLoad(cwd, SKILL_USE)

    expect(result.exitCode, result.stderr).toBe(0)
    expectSkillContent(result.stdout)
  }, 60_000)
})
