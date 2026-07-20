import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSessionCatalogue,
  formatSessionCatalogue,
  getSessionCatalogue,
} from '../src/session-catalog.js'
import { computeSkillContentHash } from '../src/core/lockfile/hash.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type { IntentSkillList } from '../src/core/index.js'

const roots: Array<string> = []

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  roots.push(root)
  return root
}

function result(
  skills: Array<{ use: string; description: string }>,
  warnings: Array<string> = [],
): IntentSkillList {
  return {
    packageManager: 'pnpm',
    skills: skills.map((skill) => ({
      ...skill,
      packageName: skill.use.split('#')[0]!,
      packageRoot: '/workspace/node_modules/package',
      packageVersion: '1.0.0',
      packageSource: 'local',
      skillName: skill.use.split('#')[1]!,
    })),
    packages: [
      {
        name: '@fixture/package',
        version: '1.0.0',
        source: 'local',
        packageRoot: '/workspace/node_modules/package',
        skillCount: skills.length,
      },
    ],
    hiddenSourceCount: 0,
    hiddenSources: [],
    warnings,
    notices: [],
    conflicts: [],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('session catalogue formatting', () => {
  it('sorts, bounds, and redacts agent context', () => {
    const catalogue = buildSessionCatalogue(
      result(
        [
          { use: '@fixture/package#z', description: 'Z guidance' },
          {
            use: '@fixture/package#a',
            description: 'Read C:\\Users\\person\\secret.txt',
          },
        ],
        ['Warning from /Users/person/project/package.json'],
      ),
    )
    const context = formatSessionCatalogue(catalogue)

    expect(catalogue.skills.map((skill) => skill.id)).toEqual([
      '@fixture/package#a',
      '@fixture/package#z',
    ])
    expect(context).toContain('@fixture/package#a: Use @fixture/package#a')
    expect(context).not.toContain('person')
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(8_000)
  })

  it('reports omitted skills within a UTF-8 byte budget', () => {
    const catalogue = buildSessionCatalogue(
      result(
        Array.from({ length: 60 }, (_, index) => ({
          use: `@fixture/package#skill-${String(index).padStart(2, '0')}`,
          description: `Guidance ${'界'.repeat(100)}`,
        })),
      ),
    )
    const context = formatSessionCatalogue(catalogue, { maxBytes: 1_200 })

    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(1_200)
    expect(context).toMatch(/additional skills omitted/)
  })

  it('preserves application route paths in descriptions', () => {
    const catalogue = buildSessionCatalogue(
      result([
        {
          use: '@fixture/package#routes',
          description: 'Use /users/:id and /posts/:slug routes',
        },
      ]),
    )

    expect(formatSessionCatalogue(catalogue)).toContain(
      'Use /users/:id and /posts/:slug routes',
    )
  })
})

describe('session catalogue cache', () => {
  it('reuses valid content and refreshes after accepted skill drift', async () => {
    const root = tempRoot('intent-catalog-cache-')
    const cacheDir = join(root, 'cache')
    const skillDir = join(root, 'skills', 'core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(skillDir, 'SKILL.md'), 'First\n')
    let discoveries = 0
    let fileOpens = 0
    const readFs = {
      ...nodeReadFs,
      openSync: (
        ...args: Parameters<NonNullable<typeof nodeReadFs.openSync>>
      ) => {
        fileOpens += 1
        return nodeReadFs.openSync!(...args)
      },
    }

    const get = () =>
      getSessionCatalogue({
        cacheDir,
        root,
        readFs,
        discover: () => {
          discoveries += 1
          return {
            result: result([
              { use: '@fixture/package#core', description: 'Core guidance' },
            ]),
            verification: [
              {
                packageRoot: root,
                skillPath: 'skills/core',
                contentHash: computeSkillContentHash({
                  packageRoot: root,
                  skillDir,
                }),
              },
            ],
          }
        },
      })

    expect((await get()).cacheStatus).toBe('miss')
    const opensAfterMiss = fileOpens
    expect((await get()).cacheStatus).toBe('hit')
    expect(fileOpens).toBeGreaterThan(opensAfterMiss)
    writeFileSync(join(skillDir, 'SKILL.md'), 'Changed\n')
    expect((await get()).cacheStatus).toBe('refresh')
    expect(discoveries).toBe(2)
  })

  it('treats a malformed cache entry as a miss', async () => {
    const root = tempRoot('intent-catalog-malformed-')
    const cacheDir = join(root, 'cache')
    writeFileSync(join(root, 'package.json'), '{}')
    let discoveries = 0
    const options = {
      cacheDir,
      root,
      discover: () => {
        discoveries += 1
        return { result: result([]), verification: [] }
      },
    }
    const first = await getSessionCatalogue(options)
    writeFileSync(first.cachePath, '{partial')

    expect((await getSessionCatalogue(options)).cacheStatus).toBe('miss')
    expect(discoveries).toBe(2)
  })
})
