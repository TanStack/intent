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
import {
  buildSessionCatalogue,
  formatSessionCatalogue,
  getSessionCatalogue,
} from '../src/session-catalog.js'
import type { IntentSkillList } from '../src/core/index.js'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  tempDirs.push(root)
  return root
}

function skillList(
  skills: IntentSkillList['skills'],
  warnings: Array<string> = [],
): IntentSkillList {
  return {
    packageManager: 'pnpm',
    skills,
    packages: [],
    hiddenSourceCount: 0,
    hiddenSources: [],
    warnings,
    notices: [],
    conflicts: [],
  }
}

function skill(
  use: string,
  description: string,
  type?: string,
): IntentSkillList['skills'][number] {
  const separator = use.lastIndexOf('#')
  const packageName = use.slice(0, separator)
  const skillName = use.slice(separator + 1)
  return {
    use,
    packageName,
    packageRoot: `/private/workspace/node_modules/${packageName}`,
    packageVersion: '1.0.0',
    packageSource: 'local',
    skillName,
    description,
    type,
  }
}

describe('session catalogue formatting', () => {
  it('sorts skill ids using ordinal order', () => {
    const catalogue = buildSessionCatalogue(
      skillList([
        skill('pkg#a-skill', 'Lowercase skill'),
        skill('pkg#Z-skill', 'Uppercase skill'),
      ]),
    )

    expect(catalogue.skills.map((entry) => entry.id)).toEqual([
      'pkg#Z-skill',
      'pkg#a-skill',
    ])
  })

  it('sorts actionable skills and normalizes descriptions without paths', () => {
    const catalogue = buildSessionCatalogue(
      skillList([
        skill('@tanstack/router#routing', '  Route\n  navigation  '),
        skill('@tanstack/query#queries', ''),
        skill('@tanstack/query#reference', 'API reference', 'reference'),
      ]),
    )

    expect(catalogue.skills).toEqual([
      {
        id: '@tanstack/query#queries',
        description: 'Use @tanstack/query#queries',
      },
      {
        id: '@tanstack/router#routing',
        description: 'Route navigation',
      },
    ])
    expect(catalogue.packageCount).toBe(0)
    expect(JSON.stringify(catalogue)).not.toContain('/private/workspace')
  })

  it.each([
    ['Windows', String.raw`Read C:\Users\alice\project\README.md`],
    ['POSIX', 'Read /opt/work/project/README.md'],
    ['generic POSIX', 'Read /projects/acme/README.md'],
    ['bracketed POSIX', 'Read [/opt/work/README.md]'],
    ['UNC', String.raw`Read \\server\share\README.md`],
    ['relative', 'Read ../private/README.md'],
    ['file URL', 'Read file:///Users/alice/project/README.md'],
  ])('replaces %s path-bearing descriptions', (_, description) => {
    const [entry] = buildSessionCatalogue(
      skillList([skill('pkg#core', description)]),
    ).skills

    expect(entry?.description).toBe('Use pkg#core')
  })

  it('preserves application route paths in descriptions', () => {
    const entries = buildSessionCatalogue(
      skillList([
        skill('pkg#home', 'Configure /home/settings routes'),
        skill('pkg#routing', 'Configure /users/:id routes and navigation'),
      ]),
    ).skills

    expect(entries.map((entry) => entry.description)).toEqual([
      'Configure /home/settings routes',
      'Configure /users/:id routes and navigation',
    ])
  })

  it('bounds large catalogues and marks truncation explicitly', () => {
    const catalogue = buildSessionCatalogue(
      skillList(
        Array.from({ length: 55 }, (_, index) =>
          skill(`pkg#skill-${String(index).padStart(2, '0')}`, 'Guidance'),
        ),
      ),
      { maxSkills: 50 },
    )

    expect(catalogue.skills).toHaveLength(50)
    expect(catalogue.totalSkillCount).toBe(55)
    expect(catalogue.truncated).toBe(true)
    expect(formatSessionCatalogue(catalogue)).toContain(
      '5 additional skills omitted',
    )
  })

  it('handles zero skills and formats warnings separately', () => {
    const catalogue = buildSessionCatalogue(
      skillList([], ['Allowlist excluded one package.']),
    )

    expect(formatSessionCatalogue(catalogue)).toBe(
      'TanStack Intent: no available skills for this workspace.\n\nWarnings:\n- Allowlist excluded one package.',
    )
  })

  it('includes safe notices without leaking local paths', () => {
    const result = skillList([])
    result.notices = [
      'One skill source is hidden by intent.skills.',
      'Ignored /private/workspace/node_modules/hidden.',
      'Conflict at /Volumes/work/packages/hidden.',
      'Conflict at /opt/work/packages/hidden.',
    ]

    const context = formatSessionCatalogue(buildSessionCatalogue(result))

    expect(context).toContain('One skill source is hidden by intent.skills.')
    expect(context).not.toContain('/private/workspace')
    expect(context).not.toContain('/Volumes/work')
    expect(context).not.toContain('/opt/work')
  })

  it('produces compact matching guidance without full skill bodies', () => {
    const context = formatSessionCatalogue(
      buildSessionCatalogue(
        skillList([
          skill('@tanstack/router#routing', 'Router routing guidance'),
        ]),
      ),
    )

    expect(context).toContain('TanStack Intent: 1 available skill')
    expect(context).toContain(
      '- @tanstack/router#routing: Router routing guidance',
    )
    expect(context).toContain('Do not run `intent list`')
    expect(context).toContain('If no skill clearly matches, continue normally.')
    expect(context.length).toBeLessThan(700)
  })

  it('bounds the complete UTF-8 context and reports omitted skills', () => {
    const catalogue = buildSessionCatalogue(
      skillList(
        Array.from({ length: 40 }, (_, index) =>
          skill(
            `pkg#skill-${String(index).padStart(2, '0')}`,
            `Route guidance ${'🧭'.repeat(80)}`,
          ),
        ),
        [`Warning ${'界'.repeat(500)}`],
      ),
      { maxSkills: 40 },
    )

    const context = formatSessionCatalogue(catalogue, { maxBytes: 1_200 })

    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(1_200)
    expect(context).toMatch(/additional skills? omitted/)
  })

  it('truncates descriptions without splitting Unicode code points', () => {
    const [entry] = buildSessionCatalogue(
      skillList([skill('pkg#core', `Guidance ${'🧭'.repeat(200)}`)]),
    ).skills

    expect(entry?.description).not.toMatch(/[\uD800-\uDFFF]$/)
    expect(
      Buffer.from(entry?.description ?? '').toString('utf8'),
    ).not.toContain('�')
  })

  it('rejects a context budget too small for complete guidance', () => {
    const catalogue = buildSessionCatalogue(
      skillList([skill('pkg#core', 'Core guidance')]),
    )

    expect(() => formatSessionCatalogue(catalogue, { maxBytes: 256 })).toThrow(
      /at least/,
    )
  })

  it('keeps long skill ids atomic when they do not fit', () => {
    const longId = `pkg#${'skill-'.repeat(200)}`
    const context = formatSessionCatalogue(
      buildSessionCatalogue(skillList([skill(longId, 'Guidance')])),
      { maxBytes: 1_000 },
    )

    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(1_000)
    expect(context).not.toContain(longId)
    expect(context).toContain('1 additional skill omitted')
  })

  it('reports warnings omitted by count and byte limits', () => {
    const result = skillList(
      [skill('pkg#core', 'Core guidance')],
      Array.from(
        { length: 12 },
        (_, index) => `Warning ${index}: ${'detail '.repeat(30)}`,
      ),
    )
    const context = formatSessionCatalogue(buildSessionCatalogue(result), {
      maxBytes: 1_100,
    })

    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(1_100)
    expect(context).toMatch(/additional warnings? omitted/)
  })
})

describe('session catalogue cache', () => {
  it('rejects synchronous discovery failures through its promise', async () => {
    const root = tempRoot('intent-session-catalog-discovery-error-')
    const cacheDir = tempRoot('intent-session-catalog-error-cache-')
    writeFileSync(join(root, 'package.json'), '{}')

    const result = getSessionCatalogue({
      cacheDir,
      root,
      discover: () => {
        throw new Error('discovery failure')
      },
    })

    await expect(result).rejects.toThrow('discovery failure')
  })

  it('reuses a valid workspace cache and refreshes after dependency changes', async () => {
    const root = tempRoot('intent-session-catalog-root-')
    const cacheDir = tempRoot('intent-session-catalog-cache-')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'app',
        dependencies: { '@tanstack/router': '1.0.0' },
        intent: { skills: ['@tanstack/router'] },
      }),
    )
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(
        skillList([
          skill('@tanstack/router#routing', 'Router routing guidance'),
        ]),
      )

    const first = await getSessionCatalogue({ cacheDir, discover, root })
    const second = await getSessionCatalogue({ cacheDir, discover, root })

    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('hit')
    expect(discover).toHaveBeenCalledTimes(1)

    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nchanged\n')
    const refreshed = await getSessionCatalogue({ cacheDir, discover, root })
    const hitAfterRefresh = await getSessionCatalogue({
      cacheDir,
      discover,
      root,
    })

    expect(refreshed.cacheStatus).toBe('refresh')
    expect(hitAfterRefresh.cacheStatus).toBe('hit')
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('refreshes after Intent allowlist or exclusion configuration changes', async () => {
    const root = tempRoot('intent-session-catalog-config-root-')
    const cacheDir = tempRoot('intent-session-catalog-config-cache-')
    const packagePath = join(root, 'package.json')
    writeFileSync(
      packagePath,
      JSON.stringify({ intent: { skills: ['@tanstack/router'], exclude: [] } }),
    )
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(skillList([]))

    await getSessionCatalogue({ cacheDir, discover, root })
    writeFileSync(
      packagePath,
      JSON.stringify({
        intent: {
          skills: ['@tanstack/router', '@tanstack/query'],
          exclude: ['@tanstack/router#legacy'],
        },
      }),
    )
    const refreshed = await getSessionCatalogue({ cacheDir, discover, root })

    expect(refreshed.cacheStatus).toBe('refresh')
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('ignores malformed cache files and survives cache write failures', async () => {
    const root = tempRoot('intent-session-catalog-invalid-root-')
    const cacheDir = tempRoot('intent-session-catalog-invalid-cache-')
    writeFileSync(join(root, 'package.json'), '{}')
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(skillList([skill('pkg#core', 'Core guidance')]))

    const first = await getSessionCatalogue({ cacheDir, discover, root })
    const cachePath = first.cachePath
    writeFileSync(cachePath, '{partial')
    const recovered = await getSessionCatalogue({ cacheDir, discover, root })

    expect(recovered.cacheStatus).toBe('miss')
    expect(discover).toHaveBeenCalledTimes(2)

    rmSync(cacheDir, { recursive: true, force: true })
    writeFileSync(cacheDir, 'not a directory')
    const uncached = await getSessionCatalogue({ cacheDir, discover, root })

    expect(uncached.catalogue.skills).toHaveLength(1)
    expect(readFileSync(cacheDir, 'utf8')).toBe('not a directory')
  })

  it('keeps separate workspaces in separate cache entries', async () => {
    const firstRoot = tempRoot('intent-session-catalog-first-root-')
    const secondRoot = tempRoot('intent-session-catalog-second-root-')
    const cacheDir = tempRoot('intent-session-catalog-shared-cache-')
    writeFileSync(join(firstRoot, 'package.json'), '{}')
    writeFileSync(join(secondRoot, 'package.json'), '{}')
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(skillList([]))

    const first = await getSessionCatalogue({
      cacheDir,
      discover,
      root: firstRoot,
    })
    const second = await getSessionCatalogue({
      cacheDir,
      discover,
      root: secondRoot,
    })

    expect(first.cachePath).not.toBe(second.cachePath)
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('keeps nested package policy scopes in separate cache entries', async () => {
    const root = tempRoot('intent-session-catalog-policy-root-')
    const firstPackage = join(root, 'packages', 'first')
    const secondPackage = join(root, 'packages', 'second')
    const cacheDir = tempRoot('intent-session-catalog-policy-cache-')
    writeFileSync(join(root, 'package.json'), '{}')
    mkdirSync(firstPackage, { recursive: true })
    writeFileSync(join(firstPackage, 'package.json'), '{}')
    mkdirSync(secondPackage, { recursive: true })
    writeFileSync(join(secondPackage, 'package.json'), '{}')
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(skillList([]))

    const first = await getSessionCatalogue({
      cacheDir,
      discover,
      policyRoot: firstPackage,
      root,
    })
    const second = await getSessionCatalogue({
      cacheDir,
      discover,
      policyRoot: secondPackage,
      root,
    })

    expect(first.cachePath).not.toBe(second.cachePath)
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('refreshes when a nested policy manifest changes', async () => {
    const root = tempRoot('intent-session-catalog-nested-refresh-root-')
    const policyRoot = join(root, 'packages', 'nested')
    const cacheDir = tempRoot('intent-session-catalog-nested-refresh-cache-')
    writeFileSync(join(root, 'package.json'), '{}')
    mkdirSync(policyRoot, { recursive: true })
    writeFileSync(
      join(policyRoot, 'package.json'),
      JSON.stringify({ intent: { skills: ['@scope/pkg'] } }),
    )
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(skillList([skill('@scope/pkg#core', 'Core guidance')]))

    await getSessionCatalogue({ cacheDir, discover, policyRoot, root })
    writeFileSync(
      join(policyRoot, 'package.json'),
      JSON.stringify({ intent: { skills: [] } }),
    )
    const refreshed = await getSessionCatalogue({
      cacheDir,
      discover,
      policyRoot,
      root,
    })

    expect(refreshed.cacheStatus).toBe('refresh')
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('refreshes when deno.lock changes', async () => {
    const root = tempRoot('intent-session-catalog-deno-root-')
    const cacheDir = tempRoot('intent-session-catalog-deno-cache-')
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'deno.lock'), '{"version":"4"}\n')
    const discover = vi
      .fn<() => IntentSkillList>()
      .mockReturnValue(skillList([]))

    await getSessionCatalogue({ cacheDir, discover, root })
    writeFileSync(join(root, 'deno.lock'), '{"version":"4","changed":true}\n')
    const refreshed = await getSessionCatalogue({ cacheDir, discover, root })

    expect(refreshed.cacheStatus).toBe('refresh')
    expect(discover).toHaveBeenCalledTimes(2)
  })
})
