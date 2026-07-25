import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getIntentCatalogContext,
  runSessionCatalogueHook,
} from '../src/catalog.js'
import { computeSkillContentHash } from '../src/core/lockfile/hash.js'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'

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

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('getIntentCatalogContext', () => {
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

  it('withholds a newly discovered skill without changing accepted siblings', async () => {
    const { root, packageRoot } = fixture()
    const newSkillDir = join(packageRoot, 'skills', 'new-skill')
    mkdirSync(newSkillDir, { recursive: true })
    writeFileSync(
      join(newSkillDir, 'SKILL.md'),
      '---\nname: new-skill\ndescription: New package guidance\n---\n',
    )

    const result = await getIntentCatalogContext({ cwd: root })

    expect(result.context).toContain('@fixture/package#core')
    expect(result.context).toContain('@fixture/package#sibling')
    expect(result.context).not.toContain('@fixture/package#new-skill')
  })
})

describe('runSessionCatalogueHook', () => {
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
