import { describe, expect, it } from 'vitest'
import { resolveSourceArg } from '../src/commands/skills/support.js'
import type { SourceIdentity } from '../src/core/types.js'

describe('resolveSourceArg', () => {
  it('parses an explicit npm:id form', () => {
    expect(resolveSourceArg('npm:@tanstack/query', [])).toEqual({
      kind: 'npm',
      id: '@tanstack/query',
    })
  })

  it('parses an explicit workspace:id form', () => {
    expect(resolveSourceArg('workspace:router', [])).toEqual({
      kind: 'workspace',
      id: 'router',
    })
  })

  it('rejects an unsupported kind prefix', () => {
    expect(() => resolveSourceArg('git:foo', [])).toThrow(/Invalid source/)
  })

  it('rejects a bare colon with no kind', () => {
    expect(() => resolveSourceArg(':foo', [])).toThrow(/Invalid source/)
  })

  it('strips a trailing @version label as produced by diff.ts for added/removed', () => {
    expect(resolveSourceArg('npm:foo@1.2.3', [])).toEqual({
      kind: 'npm',
      id: 'foo',
    })
  })

  it('does not strip a scoped package name as if it were an @version suffix', () => {
    expect(resolveSourceArg('npm:@tanstack/query', [])).toEqual({
      kind: 'npm',
      id: '@tanstack/query',
    })
  })

  it('does not strip a trailing @-segment that does not start with a digit', () => {
    // Documents the known limitation: a hand-edited "v1.0.0"-style version
    // (not diff.ts's own output format) is treated as part of the id, not
    // stripped, since the heuristic only strips a digit-leading suffix.
    expect(resolveSourceArg('npm:foo@vNext', [])).toEqual({
      kind: 'npm',
      id: 'foo@vNext',
    })
  })

  it('resolves a bare name to its single discovered match', () => {
    const discovered: Array<SourceIdentity> = [{ kind: 'npm', id: 'foo' }]

    expect(resolveSourceArg('foo', discovered)).toEqual({
      kind: 'npm',
      id: 'foo',
    })
  })

  it('errors when a bare name matches nothing discovered', () => {
    expect(() => resolveSourceArg('foo', [])).toThrow(
      /No discovered source matches "foo"/,
    )
  })

  it('errors on a bare name matching sources of two different kinds', () => {
    const discovered: Array<SourceIdentity> = [
      { kind: 'npm', id: 'foo' },
      { kind: 'workspace', id: 'foo' },
    ]

    expect(() => resolveSourceArg('foo', discovered)).toThrow(
      /Ambiguous source "foo": matches npm:foo and workspace:foo/,
    )
  })

  it('does not consider a same-kind duplicate as ambiguous input (single discovered set is already deduped)', () => {
    const discovered: Array<SourceIdentity> = [{ kind: 'npm', id: 'foo' }]

    expect(resolveSourceArg('foo', discovered)).toEqual({
      kind: 'npm',
      id: 'foo',
    })
  })
})
