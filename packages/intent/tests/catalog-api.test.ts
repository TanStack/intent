import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCatalogueLock } from '../src/catalog-lock.js'
import {
  getIntentCatalogContext,
  runSessionCatalogueHook,
} from '../src/catalog.js'
import { listIntentSkills } from '../src/core/index.js'
import { computeSkillContentHash } from '../src/core/lockfile/hash.js'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { getProjectReadFs } from '../src/discovery/scanner.js'
import {
  formatSessionCatalogue,
  getSessionCatalogue,
} from '../src/session-catalog.js'
import type { ReadFs } from '../src/shared/utils.js'

const roots: Array<string> = []

function fixture(): { root: string; packageRoot: string; skillDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'intent-catalog-api-'))
  const packageRoot = join(root, 'node_modules', '@fixture', 'package')
  const skillDir = join(packageRoot, 'skills', 'core')
  const siblingDir = join(packageRoot, 'skills', 'sibling')
  roots.push(root)
  mkdirSync(skillDir, { recursive: true })
  mkdirSync(siblingDir, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'catalog-consumer',
      private: true,
      dependencies: { '@fixture/package': '1.0.0' },
      intent: { skills: ['@fixture/package'] },
    }),
  )
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@fixture/package',
      version: '1.0.0',
      intent: { version: 1, repo: 'fixture/package', docs: 'docs/' },
    }),
  )
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: core\ndescription: Core package guidance\n---\n\nBody.\n',
  )
  writeFileSync(
    join(siblingDir, 'SKILL.md'),
    '---\nname: sibling\ndescription: Sibling package guidance\n---\n',
  )
  writeIntentLockfile(join(root, 'intent.lock'), {
    lockfileVersion: 1,
    sources: [
      {
        kind: 'npm',
        id: '@fixture/package',
        skills: [
          {
            path: 'skills/core',
            contentHash: computeSkillContentHash({ packageRoot, skillDir }),
          },
          {
            path: 'skills/sibling',
            contentHash: computeSkillContentHash({
              packageRoot,
              skillDir: siblingDir,
            }),
          },
        ],
      },
    ],
  })
  return { root, packageRoot, skillDir }
}

async function getFixtureCatalogContext(
  root: string,
  cacheDir: string,
  readFs: ReadFs = getProjectReadFs(root),
) {
  let warnings: Array<string> = []
  const result = await getSessionCatalogue({
    cacheDir,
    root,
    readFs,
    discover: () => {
      const discovered = applyCatalogueLock(
        listIntentSkills({ audience: 'agent', cwd: root }),
        root,
        readFs,
      )
      warnings = discovered.result.warnings
      return discovered
    },
  })
  return {
    ...result,
    context: formatSessionCatalogue(result.catalogue),
    warnings,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('getIntentCatalogContext', () => {
  it('refreshes without replacing an existing cache after intent.lock is removed', async () => {
    const { root, skillDir } = fixture()
    const cacheDir = join(root, 'cache')
    const first = await getFixtureCatalogContext(root, cacheDir)
    const cachedBytes = readFileSync(first.cachePath)
    rmSync(join(root, 'intent.lock'))
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: core\ndescription: Changed unverified guidance\n---\n',
    )

    const changed = await getFixtureCatalogContext(root, cacheDir)

    expect(first.cacheStatus).toBe('miss')
    expect(changed.cacheStatus).toBe('refresh')
    expect(changed.context).toContain('Changed unverified guidance')
    expect(changed.context).not.toContain('Core package guidance')
    expect(readFileSync(first.cachePath)).toEqual(cachedBytes)
  })

  it('rediscovers changed context when intent.lock is missing', async () => {
    const { root, skillDir } = fixture()
    rmSync(join(root, 'intent.lock'))

    const first = await getIntentCatalogContext({ cwd: root })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: core\ndescription: Changed guidance\n---\n',
    )
    const changed = await getIntentCatalogContext({ cwd: root })

    expect(first.cacheStatus).toBe('miss')
    expect(first.context).toContain('Core package guidance')
    expect(changed.cacheStatus).toBe('miss')
    expect(changed.context).toContain('Changed guidance')
    expect(changed.context).not.toContain('Core package guidance')
  })

  it('reuses accepted context and withholds drifted skill content', async () => {
    const { root, skillDir } = fixture()

    const first = await getIntentCatalogContext({ cwd: root })
    const second = await getIntentCatalogContext({ cwd: root })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: core\ndescription: Changed guidance\n---\n',
    )
    const changed = await getIntentCatalogContext({ cwd: root })

    expect(first.cacheStatus).toBe('miss')
    expect(Object.keys(first).sort()).toEqual(['cacheStatus', 'context'])
    expect(first.context).toContain('@fixture/package#core')
    expect(second.cacheStatus).toBe('hit')
    expect(changed.cacheStatus).toBe('refresh')
    expect(changed.context).not.toContain('@fixture/package#core')
    expect(changed.context).toContain('@fixture/package#sibling')
  })

  it('restores an accepted skill after its exact locked content returns', async () => {
    const { root, skillDir } = fixture()
    const cacheDir = join(root, 'cache')
    const originalSkill = readFileSync(join(skillDir, 'SKILL.md'))
    const first = await getFixtureCatalogContext(root, cacheDir)
    const cachedBytes = readFileSync(first.cachePath)

    expect(first.cacheStatus).toBe('miss')
    expect(first.context).toContain('@fixture/package#core')
    expect(first.context).toContain('@fixture/package#sibling')

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: core\ndescription: Drifted guidance\n---\n',
    )

    const drifted = await getFixtureCatalogContext(root, cacheDir)

    expect(drifted.cacheStatus).toBe('refresh')
    expect(drifted.context).not.toContain('@fixture/package#core')
    expect(drifted.context).toContain('@fixture/package#sibling')
    expect(drifted.warnings).toContain(
      '1 skill was withheld because installed content does not match intent.lock.',
    )

    const unchangedDrifted = await getFixtureCatalogContext(root, cacheDir)

    expect(unchangedDrifted.cacheStatus).toBe('hit')
    expect(unchangedDrifted.context).not.toContain('@fixture/package#core')
    expect(unchangedDrifted.context).toContain('@fixture/package#sibling')
    expect(readFileSync(first.cachePath)).not.toEqual(cachedBytes)

    writeFileSync(join(skillDir, 'SKILL.md'), originalSkill)
    const restored = await getFixtureCatalogContext(root, cacheDir)

    expect(restored.cacheStatus).toBe('refresh')
    expect(restored.context).toContain('@fixture/package#core')
    expect(restored.context).toContain('@fixture/package#sibling')
  })

  it('withholds a newly discovered skill without changing accepted siblings', async () => {
    const { root, packageRoot } = fixture()
    const cacheDir = join(root, 'cache')
    const newSkillDir = join(packageRoot, 'skills', 'new-skill')
    mkdirSync(newSkillDir, { recursive: true })
    writeFileSync(
      join(newSkillDir, 'SKILL.md'),
      '---\nname: new-skill\ndescription: New package guidance\n---\n',
    )

    const first = await getFixtureCatalogContext(root, cacheDir)
    const second = await getFixtureCatalogContext(root, cacheDir)

    expect(first.cacheStatus).toBe('miss')
    expect(first.context).toContain('@fixture/package#core')
    expect(first.context).toContain('@fixture/package#sibling')
    expect(first.context).not.toContain('@fixture/package#new-skill')
    expect(first.warnings).toContain(
      '1 skill was withheld because no matching intent.lock entry exists.',
    )
    expect(second.cacheStatus).toBe('hit')
    expect(second.context).toEqual(first.context)
  })

  it('withholds an unhashable skill without withholding a healthy sibling or caching', async () => {
    const { root, skillDir } = fixture()
    const cacheDir = join(root, 'cache')
    const nodeFs = getProjectReadFs(root)
    const readFs: ReadFs = {
      ...nodeFs,
      realpathSync: ((path: Parameters<ReadFs['realpathSync']>[0]) => {
        if (String(path).startsWith(skillDir)) {
          throw new Error('Injected unhashable skill')
        }
        return nodeFs.realpathSync(path)
      }) as ReadFs['realpathSync'],
    }

    const first = await getFixtureCatalogContext(root, cacheDir, readFs)
    const second = await getFixtureCatalogContext(root, cacheDir, readFs)

    expect(first.cacheStatus).toBe('miss')
    expect(first.context).not.toContain('@fixture/package#core')
    expect(first.context).toContain('@fixture/package#sibling')
    expect(first.warnings).toContain(
      '1 skill was withheld because installed content could not be verified.',
    )
    expect(second.cacheStatus).toBe('miss')
    expect(second.context).toEqual(first.context)
  })
})

describe('runSessionCatalogueHook', () => {
  it('writes generic Copilot context when the catalogue cannot be built', async () => {
    const { root } = fixture()
    writeFileSync(join(root, 'intent.lock'), '{broken')
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await runSessionCatalogueHook({
      agent: 'copilot',
      event: { cwd: root, source: 'startup' },
    })

    expect(stdout).toHaveBeenCalledTimes(1)
    const output = String(stdout.mock.calls[0]![0])
    expect(JSON.parse(output)).toEqual({
      additionalContext:
        'Intent skills are unavailable because the catalogue could not be built. Run `intent catalog` outside the agent session for details.',
    })
    expect(stderr).toHaveBeenCalledTimes(1)
    expect(String(stderr.mock.calls[0]![0])).toContain(
      '[intent catalog] hook failed open:',
    )
    expect(output).not.toContain('Invalid intent.lock JSON')
    expect(output).not.toContain(root)
  })

  it('writes the documented Copilot output shape', async () => {
    const { root } = fixture()
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await runSessionCatalogueHook({
      agent: 'copilot',
      event: { cwd: root, source: 'startup' },
    })

    expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toMatchObject({
      additionalContext: expect.stringContaining('@fixture/package#core'),
    })
    expect(stderr).not.toHaveBeenCalled()
  })

  it('writes the documented Codex output shape', async () => {
    const { root } = fixture()
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await runSessionCatalogueHook({
      agent: 'codex',
      event: { cwd: root, hook_event_name: 'SessionStart' },
    })

    expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringContaining('@fixture/package#core'),
      },
    })
    expect(stderr).not.toHaveBeenCalled()
  })

  it('ignores non-lifecycle events', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await runSessionCatalogueHook({ agent: 'claude', event: {} })

    expect(stdout).not.toHaveBeenCalled()
  })
})
