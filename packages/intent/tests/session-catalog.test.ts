import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  notices: Array<string> = [],
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
    notices,
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
    expect(catalogue.skills[0]?.description).toBe('Use @fixture/package#a')
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

    expect(catalogue.skills).toHaveLength(50)
    expect(catalogue.totalSkillCount).toBe(60)
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

  it('excludes warnings and human-facing notices', () => {
    const catalogue = buildSessionCatalogue(
      result([], ['Agent warning'], ['Maintainer notice']),
    )
    const context = formatSessionCatalogue(catalogue)

    expect(catalogue).toEqual({ skills: [], totalSkillCount: 0 })
    expect(context).not.toContain('Agent warning')
    expect(context).not.toContain('Maintainer notice')
  })

  it('excludes warnings regardless of warning count', () => {
    const catalogue = buildSessionCatalogue(
      result(
        [],
        Array.from({ length: 12 }, (_, index) => `Warning ${index + 1}`),
        ['Maintainer notice'],
      ),
    )
    const context = formatSessionCatalogue(catalogue)

    expect(catalogue).toEqual({ skills: [], totalSkillCount: 0 })
    expect(context).not.toContain('Warning 1')
    expect(context).not.toContain('additional warnings omitted')
    expect(context).not.toContain('Maintainer notice')
  })

  it('omits diagnostics when only notices are present', () => {
    const catalogue = buildSessionCatalogue(
      result([], [], ['Maintainer notice']),
    )
    const context = formatSessionCatalogue(catalogue)

    expect(catalogue).toEqual({ skills: [], totalSkillCount: 0 })
    expect(context).not.toContain('Warnings:')
    expect(context).not.toContain('Maintainer notice')
  })
})

describe('session catalogue cache', () => {
  it('fails open when the default temporary directory cannot be resolved', async () => {
    const root = tempRoot('intent-catalog-missing-temp-')
    const missingTempRoot = join(root, 'missing')
    writeFileSync(join(root, 'package.json'), '{}')
    const originalTmpdir = process.env.TMPDIR
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    try {
      process.env.TMPDIR = missingTempRoot
      vi.resetModules()
      const catalog = await import('../src/session-catalog.js')
      const discovered = await catalog.getSessionCatalogue({
        root,
        discover: () => ({
          result: result([
            {
              use: '@fixture/package#core',
              description: 'Safe guidance',
            },
          ]),
          verification: [],
        }),
      })

      expect(discovered.cacheStatus).toBe('miss')
      expect(catalog.formatSessionCatalogue(discovered.catalogue)).toContain(
        'Safe guidance',
      )
      expect(existsSync(discovered.cachePath)).toBe(false)
      expect(
        stderr.mock.calls.filter(([chunk]) =>
          String(chunk).includes('caching is disabled'),
        ),
      ).toHaveLength(1)
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = originalTmpdir
      vi.resetModules()
      stderr.mockRestore()
    }
  })

  it('uses a private immediate child of the current temporary directory by default', async ({
    skip,
  }) => {
    if (typeof process.getuid !== 'function') {
      skip()
      return
    }

    const root = tempRoot('intent-catalog-default-root-')
    const importTempRoot = tempRoot('intent-catalog-import-temp-')
    const defaultTempRoot = tempRoot('intent-catalog-default-temp-')
    const realDefaultTempRoot = realpathSync.native(defaultTempRoot)
    writeFileSync(join(root, 'package.json'), '{}')
    const originalTmpdir = process.env.TMPDIR
    let discoveries = 0

    try {
      process.env.TMPDIR = importTempRoot
      vi.resetModules()
      const { getSessionCatalogue: getFreshSessionCatalogue } =
        await import('../src/session-catalog.js')
      process.env.TMPDIR = defaultTempRoot
      const options = {
        root,
        discover: () => {
          discoveries += 1
          return { result: result([]), verification: [] }
        },
      }

      const first = await getFreshSessionCatalogue(options)
      const cacheDir = dirname(first.cachePath)

      expect(dirname(cacheDir)).toBe(realDefaultTempRoot)
      expect(basename(cacheDir)).toMatch(/^tanstack-intent-.*-catalogues$/)
      expect(statSync(cacheDir).mode & 0o777).toBe(0o700)
      expect(statSync(first.cachePath).mode & 0o777).toBe(0o600)

      chmodSync(cacheDir, 0o755)
      const second = await getFreshSessionCatalogue(options)

      expect(second.cacheStatus).toBe('hit')
      expect(second.cachePath).toBe(first.cachePath)
      expect(statSync(cacheDir).mode & 0o777).toBe(0o700)
      expect(discoveries).toBe(1)
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = originalTmpdir
      vi.resetModules()
    }
  })

  it('bypasses a supplied cache directory symlink', async ({ skip }) => {
    const root = tempRoot('intent-catalog-directory-symlink-')
    const targetDir = join(root, 'target')
    const cacheDir = join(root, 'cache')
    mkdirSync(targetDir)
    writeFileSync(join(root, 'package.json'), '{}')
    try {
      symlinkSync(targetDir, cacheDir, 'dir')
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        ['EACCES', 'ENOTSUP', 'EPERM'].includes(String(error.code))
      ) {
        skip()
        return
      }
      throw error
    }

    let discoveries = 0
    const options = {
      cacheDir,
      root,
      discover: () => {
        discoveries += 1
        return { result: result([]), verification: [] }
      },
    }
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    try {
      const first = await getSessionCatalogue(options)
      const second = await getSessionCatalogue(options)
      const cacheWarnings = stderr.mock.calls.filter(([chunk]) =>
        String(chunk).includes('caching is disabled'),
      )

      expect(first.cacheStatus).toBe('miss')
      expect(second.cacheStatus).toBe('miss')
      expect(discoveries).toBe(2)
      expect(existsSync(first.cachePath)).toBe(false)
      expect(cacheWarnings).toHaveLength(1)
      expect(String(cacheWarnings[0]?.[0])).toContain(cacheDir)
    } finally {
      stderr.mockRestore()
    }
  })

  it('does not serve a cache file symlink', async ({ skip }) => {
    if (typeof process.getuid !== 'function') {
      skip()
      return
    }

    const root = tempRoot('intent-catalog-file-symlink-')
    const cacheDir = join(root, 'cache')
    const externalCachePath = join(root, 'external-cache.json')
    writeFileSync(join(root, 'package.json'), '{}')
    let discoveries = 0
    const options = {
      cacheDir,
      root,
      discover: () => {
        discoveries += 1
        return {
          result: result([
            {
              use: '@fixture/package#core',
              description: 'Safe guidance',
            },
          ]),
          verification: [],
        }
      },
    }
    const first = await getSessionCatalogue(options)
    const persisted = JSON.parse(readFileSync(first.cachePath, 'utf8')) as {
      catalogue: { skills: Array<{ description: string }> }
    }
    persisted.catalogue.skills[0]!.description = 'Modified guidance'
    writeFileSync(externalCachePath, JSON.stringify(persisted))
    unlinkSync(first.cachePath)
    try {
      symlinkSync(externalCachePath, first.cachePath)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        ['EACCES', 'ENOTSUP', 'EPERM'].includes(String(error.code))
      ) {
        skip()
        return
      }
      throw error
    }

    const second = await getSessionCatalogue(options)

    expect(second.cacheStatus).toBe('miss')
    expect(second.catalogue.skills[0]?.description).toBe('Safe guidance')
    expect(discoveries).toBe(2)
    expect(lstatSync(first.cachePath).isSymbolicLink()).toBe(false)
    expect(lstatSync(first.cachePath).isFile()).toBe(true)
  })

  it('replaces a writable cache file instead of serving it', async ({
    skip,
  }) => {
    if (typeof process.getuid !== 'function') {
      skip()
      return
    }

    const root = tempRoot('intent-catalog-writable-file-')
    const cacheDir = join(root, 'cache')
    writeFileSync(join(root, 'package.json'), '{}')
    let discoveries = 0
    const options = {
      cacheDir,
      root,
      discover: () => {
        discoveries += 1
        return {
          result: result([
            {
              use: '@fixture/package#core',
              description: 'Safe guidance',
            },
          ]),
          verification: [],
        }
      },
    }
    const first = await getSessionCatalogue(options)
    const persisted = JSON.parse(readFileSync(first.cachePath, 'utf8')) as {
      catalogue: { skills: Array<{ description: string }> }
    }
    persisted.catalogue.skills[0]!.description = 'Modified guidance'
    writeFileSync(first.cachePath, JSON.stringify(persisted))
    chmodSync(first.cachePath, 0o666)

    const second = await getSessionCatalogue(options)

    expect(second.cacheStatus).toBe('miss')
    expect(second.catalogue.skills[0]?.description).toBe('Safe guidance')
    expect(second.cachePath).toBe(first.cachePath)
    expect(discoveries).toBe(2)
    expect(lstatSync(second.cachePath).isFile()).toBe(true)
    expect(statSync(second.cachePath).mode & 0o777).toBe(0o600)
  })

  it('creates custom cache directories and files with private modes', async ({
    skip,
  }) => {
    if (typeof process.getuid !== 'function') {
      skip()
      return
    }

    const root = tempRoot('intent-catalog-private-modes-')
    const cacheDir = join(root, 'cache')
    writeFileSync(join(root, 'package.json'), '{}')

    const catalogue = await getSessionCatalogue({
      cacheDir,
      root,
      discover: () => ({ result: result([]), verification: [] }),
    })

    expect(statSync(cacheDir).mode & 0o777).toBe(0o700)
    expect(statSync(catalogue.cachePath).mode & 0o777).toBe(0o600)
  })

  it('bypasses an existing writable custom cache directory without changing its mode', async ({
    skip,
  }) => {
    if (typeof process.getuid !== 'function') {
      skip()
      return
    }

    const root = tempRoot('intent-catalog-permissive-directory-')
    const cacheDir = join(root, 'cache')
    mkdirSync(cacheDir)
    chmodSync(cacheDir, 0o777)
    writeFileSync(join(root, 'package.json'), '{}')
    let discoveries = 0
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const options = {
      cacheDir,
      root,
      discover: () => {
        discoveries += 1
        return { result: result([]), verification: [] }
      },
    }

    try {
      const first = await getSessionCatalogue(options)
      const second = await getSessionCatalogue(options)

      expect(first.cacheStatus).toBe('miss')
      expect(second.cacheStatus).toBe('miss')
      expect(discoveries).toBe(2)
      expect(existsSync(first.cachePath)).toBe(false)
      expect(statSync(cacheDir).mode & 0o777).toBe(0o777)
    } finally {
      stderr.mockRestore()
    }
  })

  it('recomputes a persisted catalogue from an older schema version', async () => {
    const root = tempRoot('intent-catalog-stale-schema-')
    const cacheDir = join(root, 'cache')
    writeFileSync(join(root, 'package.json'), '{}')
    let discoveries = 0
    const options = {
      cacheDir,
      root,
      discover: () => {
        discoveries += 1
        return {
          result: result([
            {
              use: '@fixture/package#core',
              description:
                discoveries === 1 ? 'Cached guidance' : 'Recomputed guidance',
            },
          ]),
          verification: [],
        }
      },
    }
    const first = await getSessionCatalogue(options)
    const persisted = JSON.parse(readFileSync(first.cachePath, 'utf8')) as {
      schemaVersion: number
    }
    writeFileSync(
      first.cachePath,
      JSON.stringify({
        ...persisted,
        schemaVersion: persisted.schemaVersion - 1,
      }),
    )

    const recomputed = await getSessionCatalogue(options)

    expect(recomputed.cacheStatus).toBe('miss')
    expect(recomputed.catalogue.skills).toEqual([
      {
        id: '@fixture/package#core',
        description: 'Recomputed guidance',
      },
    ])
    expect(discoveries).toBe(2)
  })

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
