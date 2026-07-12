import { describe, expect, it } from 'vitest'
import { analyzeSourceImpact } from '../src/staleness/source-impact.js'

describe('analyzeSourceImpact', () => {
  it('maps exact paths and glob patterns to affected skills', () => {
    const result = analyzeSourceImpact(
      [
        {
          name: 'configuration',
          path: 'skills/configuration/SKILL.md',
          sources: ['docs/configuration.md', 'src/config/**'],
        },
      ],
      ['src/config/read.ts', 'docs/configuration.md', 'src/unrelated.ts'],
    )

    expect(result).toEqual({
      affectedSkills: [
        {
          name: 'configuration',
          path: 'skills/configuration/SKILL.md',
          matchedSources: ['docs/configuration.md', 'src/config/**'],
          changedPaths: ['docs/configuration.md', 'src/config/read.ts'],
        },
      ],
      unmappedPaths: ['src/unrelated.ts'],
    })
  })

  it('treats deleted paths as changed paths without reading the filesystem', () => {
    expect(
      analyzeSourceImpact(
        [
          {
            name: 'removed-api',
            path: 'skills/removed-api/SKILL.md',
            sources: ['src/removed.ts'],
          },
        ],
        ['src/removed.ts'],
      ).affectedSkills,
    ).toHaveLength(1)
  })

  it('reports every path as unmapped when no source matches', () => {
    expect(
      analyzeSourceImpact(
        [
          {
            name: 'core',
            path: 'skills/core/SKILL.md',
            sources: ['src/core.ts'],
          },
        ],
        ['docs/overview.md'],
      ),
    ).toEqual({
      affectedSkills: [],
      unmappedPaths: ['docs/overview.md'],
    })
  })

  it('matches package-relative patterns against monorepo-root paths', () => {
    const result = analyzeSourceImpact(
      [
        {
          name: 'router',
          path: 'skills/router/SKILL.md',
          sources: ['src/**'],
        },
      ],
      ['packages/router/src/index.ts', 'packages/query/src/index.ts'],
      'packages/router',
    )

    expect(result).toEqual({
      affectedSkills: [
        {
          name: 'router',
          path: 'skills/router/SKILL.md',
          matchedSources: ['src/**'],
          changedPaths: ['packages/router/src/index.ts'],
        },
      ],
      unmappedPaths: ['packages/query/src/index.ts'],
    })
  })

  it('deduplicates and sorts inputs and output deterministically', () => {
    const result = analyzeSourceImpact(
      [
        {
          name: 'zeta',
          path: 'skills/zeta/SKILL.md',
          sources: ['src/**', 'src/**'],
        },
        {
          name: 'alpha',
          path: 'skills/alpha/SKILL.md',
          sources: ['src/a.ts'],
        },
      ],
      ['src/z.ts', 'src/a.ts', 'src/a.ts'],
    )

    expect(result.affectedSkills.map((skill) => skill.path)).toEqual([
      'skills/alpha/SKILL.md',
      'skills/zeta/SKILL.md',
    ])
    expect(result.affectedSkills[1]?.changedPaths).toEqual([
      'src/a.ts',
      'src/z.ts',
    ])
    expect(result.unmappedPaths).toEqual([])
  })

  it('reports every overlapping source pattern that matched', () => {
    const result = analyzeSourceImpact(
      [
        {
          name: 'configuration',
          path: 'skills/configuration/SKILL.md',
          sources: ['src/**', 'src/config/**'],
        },
      ],
      ['src/config/read.ts'],
    )

    expect(result.affectedSkills[0]?.matchedSources).toEqual([
      'src/**',
      'src/config/**',
    ])
    expect(result.affectedSkills[0]?.changedPaths).toEqual([
      'src/config/read.ts',
    ])
  })

  it('treats a leading exclamation mark as a path, not glob negation', () => {
    expect(
      analyzeSourceImpact(
        [
          {
            name: 'literal',
            path: 'skills/literal/SKILL.md',
            sources: ['!generated.ts'],
          },
        ],
        ['src/unrelated.ts'],
      ).affectedSkills,
    ).toEqual([])
  })
})
