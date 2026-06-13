import { describe, expect, it } from 'vitest'
import {
  SkillSourcesParseError,
  isSkillSourcesParseError,
  parseSkillSources,
} from '../src/core/skill-sources.js'

function expectParseError(value: unknown): SkillSourcesParseError {
  try {
    parseSkillSources(value)
  } catch (err) {
    if (isSkillSourcesParseError(err)) return err
    throw err
  }
  throw new Error('Expected parseSkillSources to throw')
}

describe('parseSkillSources — list-level modes', () => {
  it('treats an absent key (undefined) as the migration show-all mode', () => {
    expect(parseSkillSources(undefined)).toEqual({ mode: 'absent' })
  })

  it('treats null as absent', () => {
    expect(parseSkillSources(null)).toEqual({ mode: 'absent' })
  })

  it('treats an empty array as deny-all (distinct from absent)', () => {
    expect(parseSkillSources([])).toEqual({ mode: 'empty' })
  })

  it('treats the "*" sentinel as allow-all', () => {
    expect(parseSkillSources(['*'])).toEqual({ mode: 'allow-all' })
  })

  it('rejects a non-array value', () => {
    const error = expectParseError('@scope/pkg')
    expect(error.issues).toEqual([
      {
        raw: null,
        message:
          'intent.skills must be an array of source strings, received string.',
      },
    ])
  })
})

describe('parseSkillSources — grammar', () => {
  it('parses a bare name as an npm source', () => {
    expect(parseSkillSources(['pkg'])).toEqual({
      mode: 'explicit',
      sources: [{ raw: 'pkg', id: 'pkg', kind: 'npm' }],
    })
  })

  it('parses a scoped name as an npm source', () => {
    expect(parseSkillSources(['@scope/pkg'])).toEqual({
      mode: 'explicit',
      sources: [{ raw: '@scope/pkg', id: '@scope/pkg', kind: 'npm' }],
    })
  })

  it('parses a workspace: entry as a workspace source', () => {
    expect(parseSkillSources(['workspace:@scope/pkg'])).toEqual({
      mode: 'explicit',
      sources: [
        { raw: 'workspace:@scope/pkg', id: '@scope/pkg', kind: 'workspace' },
      ],
    })
  })

  it('treats a colon-free entry that looks like a kind as an npm name', () => {
    expect(parseSkillSources(['workspace'])).toEqual({
      mode: 'explicit',
      sources: [{ raw: 'workspace', id: 'workspace', kind: 'npm' }],
    })
  })

  it('trims leading/trailing whitespace from an entry id', () => {
    expect(parseSkillSources(['  @scope/pkg  '])).toEqual({
      mode: 'explicit',
      sources: [{ raw: '  @scope/pkg  ', id: '@scope/pkg', kind: 'npm' }],
    })
  })

  it('preserves the original raw string while normalizing the id', () => {
    const result = parseSkillSources(['workspace:  @scope/pkg  '])
    expect(result).toEqual({
      mode: 'explicit',
      sources: [
        {
          raw: 'workspace:  @scope/pkg  ',
          id: '@scope/pkg',
          kind: 'workspace',
        },
      ],
    })
  })
})

describe('parseSkillSources — malformed entries (fail-whole-list)', () => {
  it('rejects a git: entry', () => {
    const error = expectParseError(['git:github.com/me/skills#main'])
    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]).toMatchObject({
      raw: 'git:github.com/me/skills#main',
    })
    expect(error.issues[0]?.message).toContain('not supported until')
  })

  it('rejects an unknown prefix', () => {
    const error = expectParseError(['file:./local'])
    expect(error.issues).toEqual([
      {
        raw: 'file:./local',
        message: 'Unknown source prefix "file" in "file:./local".',
      },
    ])
  })

  it('rejects an empty workspace name', () => {
    const error = expectParseError(['workspace:'])
    expect(error.issues[0]?.message).toContain('missing a package name')
  })

  it('rejects an empty / whitespace-only entry', () => {
    const error = expectParseError(['   '])
    expect(error.issues).toEqual([{ raw: '   ', message: 'Entry is empty.' }])
  })

  it('rejects a non-string entry', () => {
    const error = expectParseError([42])
    expect(error.issues).toEqual([
      { raw: null, message: 'Entry must be a string, received number.' },
    ])
  })

  it('rejects exact duplicate raw entries', () => {
    const error = expectParseError(['@scope/pkg', '@scope/pkg'])
    expect(error.issues).toEqual([
      { raw: '@scope/pkg', message: 'Duplicate entry.' },
    ])
  })

  it('collects every error across the list and reports them together', () => {
    const error = expectParseError([
      'git:github.com/me/skills#main',
      'file:./local',
      'workspace:',
      '',
    ])
    expect(error.issues).toHaveLength(4)
    expect(error.issues.map((issue) => issue.raw)).toEqual([
      'git:github.com/me/skills#main',
      'file:./local',
      'workspace:',
      '',
    ])
  })

  it('does not apply a partial allowlist when any entry is malformed', () => {
    expect(() =>
      parseSkillSources(['@scope/good', 'git:github.com/me/skills#main']),
    ).toThrow(SkillSourcesParseError)
  })
})

describe('parseSkillSources — normalization and dedup', () => {
  it('dedups the same id+kind from differently-formatted raw entries', () => {
    const result = parseSkillSources(['@scope/pkg', '  @scope/pkg  '])
    expect(result).toEqual({
      mode: 'explicit',
      sources: [{ raw: '@scope/pkg', id: '@scope/pkg', kind: 'npm' }],
    })
  })

  it('keeps the same name under different kinds as distinct sources', () => {
    expect(parseSkillSources(['foo', 'workspace:foo'])).toEqual({
      mode: 'explicit',
      sources: [
        { raw: 'foo', id: 'foo', kind: 'npm' },
        { raw: 'workspace:foo', id: 'foo', kind: 'workspace' },
      ],
    })
  })

  it('treats id case variance as distinct (case-sensitive)', () => {
    expect(parseSkillSources(['@scope/foo', '@scope/FOO'])).toEqual({
      mode: 'explicit',
      sources: [
        { raw: '@scope/foo', id: '@scope/foo', kind: 'npm' },
        { raw: '@scope/FOO', id: '@scope/FOO', kind: 'npm' },
      ],
    })
  })

  it('treats prefix case variance as an unknown prefix', () => {
    const error = expectParseError(['Workspace:foo'])
    expect(error.issues[0]?.message).toContain(
      'Unknown source prefix "Workspace"',
    )
  })
})

describe('parseSkillSources — wildcard composition', () => {
  it('subsumes redundant npm/workspace entries listed alongside "*"', () => {
    expect(parseSkillSources(['*', '@scope/pkg', 'workspace:foo'])).toEqual({
      mode: 'allow-all',
    })
  })

  it('fails the whole list when "*" is combined with a git entry', () => {
    const error = expectParseError(['*', 'git:github.com/me/skills#main'])
    expect(error.issues).toHaveLength(1)
    expect(error.issues[0]?.raw).toBe('git:github.com/me/skills#main')
  })

  it('rejects a duplicate "*" entry', () => {
    const error = expectParseError(['*', '*'])
    expect(error.issues).toEqual([{ raw: '*', message: 'Duplicate entry.' }])
  })

  it('requires the wildcard to be the exact string "*" (whitespace-wrapped is rejected)', () => {
    const error = expectParseError([' * '])
    expect(error.issues[0]?.message).toContain('must be the exact entry "*"')
  })

  it('does not flip to allow-all from a non-breaking-space-wrapped star', () => {
    const error = expectParseError(['\u00A0*\u00A0'])
    expect(error.issues[0]?.message).toContain('must be the exact entry "*"')
  })

  it('rejects a glob in a package segment', () => {
    const error = expectParseError(['@scope/*'])
    expect(error.issues[0]?.message).toContain('globs are not supported')
  })

  it('still throws a duplicate error even when "*" subsumes the duplicated entry', () => {
    const error = expectParseError(['*', 'x', 'x'])
    expect(error.issues).toEqual([{ raw: 'x', message: 'Duplicate entry.' }])
  })
})

describe('parseSkillSources — id validation', () => {
  it('rejects skill-level granularity (#) in an npm entry', () => {
    const error = expectParseError(['@scope/pkg#skill'])
    expect(error.issues[0]?.message).toContain('skill-level granularity')
  })

  it('rejects internal whitespace in a package name', () => {
    const error = expectParseError(['a b'])
    expect(error.issues[0]?.message).toContain('cannot contain whitespace')
  })

  it('rejects a stray separator in a workspace name', () => {
    const error = expectParseError(['workspace:a:b'])
    expect(error.issues[0]?.message).toContain('cannot contain ":"')
  })
})

describe('parseSkillSources — error reporting', () => {
  it('reports both the parse error and the duplicate for a repeated invalid entry', () => {
    const error = expectParseError([
      'git:github.com/me/skills#main',
      'git:github.com/me/skills#main',
    ])
    expect(error.issues).toHaveLength(2)
    expect(error.issues[0]?.message).toContain('not supported until')
    expect(error.issues[1]?.message).toBe('Duplicate entry.')
  })

  it('renders a human-readable message listing every issue', () => {
    const error = expectParseError(['file:./local', '   '])
    expect(error.message).toContain('Invalid intent.skills configuration:')
    expect(error.message).toContain(
      '"file:./local": Unknown source prefix "file"',
    )
    expect(error.message).toContain('Entry is empty.')
  })

  it('describes an array entry by type', () => {
    const error = expectParseError([['nested']])
    expect(error.issues).toEqual([
      { raw: null, message: 'Entry must be a string, received array.' },
    ])
  })
})
