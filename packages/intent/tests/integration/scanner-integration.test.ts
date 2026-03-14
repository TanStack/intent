import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PackageManager, ProjectStructure, Registry } from './scaffold.js'
import {
  publishFixtures,
  runScanner,
  scaffoldProject,
  startRegistry,
} from './scaffold.js'

const PACKAGE_MANAGERS: Array<PackageManager> = ['npm', 'pnpm', 'yarn', 'bun']
const STRUCTURES: Array<ProjectStructure> = [
  'single',
  'monorepo-root',
  'monorepo-workspace',
]
const DEPENDENCY_CHAINS: Array<{ label: string; dep: string }> = [
  { label: 'direct', dep: '@test-intent/skills-leaf' },
  { label: 'transitive+1', dep: '@test-intent/wrapper-1' },
  { label: 'transitive+2', dep: '@test-intent/wrapper-2' },
  { label: 'transitive+3', dep: '@test-intent/wrapper-3' },
]

let registry: Registry
const tempDirs: Array<string> = []

beforeAll(async () => {
  registry = await startRegistry()
  publishFixtures(registry.url)
}, 30_000)

afterAll(() => {
  registry?.stop()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.each(PACKAGE_MANAGERS)('package manager: %s', (pm) => {
  describe.each(STRUCTURES)('structure: %s', (structure) => {
    describe.each(DEPENDENCY_CHAINS)('dependency: $label', ({ dep }) => {
      it('discovers @test-intent/skills-leaf and its core skill', () => {
        const { root, cwd } = scaffoldProject({
          pm,
          structure,
          dependency: dep,
          registryUrl: registry.url,
        })
        tempDirs.push(root)

        const result = runScanner(cwd)

        expect(result.exitCode).toBe(0)
        expect(result.parsed).toBeTruthy()
        expect(result.parsed.packages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: '@test-intent/skills-leaf',
              version: '1.0.0',
              skills: expect.arrayContaining([
                expect.objectContaining({ name: 'core', type: 'core' }),
              ]),
            }),
          ]),
        )
      }, 60_000)
    })
  })
})

describe('symlink invocation', () => {
  it('finds skills when CLI is invoked through a symlink', () => {
    const { root, cwd } = scaffoldProject({
      pm: 'npm',
      structure: 'single',
      dependency: '@test-intent/skills-leaf',
      registryUrl: registry.url,
    })
    tempDirs.push(root)

    const result = runScanner(cwd, 'symlink')

    expect(result.exitCode).toBe(0)
    expect(result.parsed.packages).toHaveLength(1)
    expect(result.parsed.packages[0].name).toBe('@test-intent/skills-leaf')
  }, 60_000)
})
