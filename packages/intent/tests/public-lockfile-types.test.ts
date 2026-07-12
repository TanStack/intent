import { describe, expectTypeOf, it } from 'vitest'
import type {
  IntentLockfile,
  IntentLockfilePolicy,
  IntentLockfilePolicyIgnore,
  IntentLockfileSource,
  IntentLockfileStaleness,
  IntentLockfileStalenessBaseline,
  ReadIntentLockfileResult,
  SourceIdentity,
} from '@tanstack/intent'

describe('public lockfile types', () => {
  it('imports lockfile and source identity types from the package root', () => {
    const source: IntentLockfileSource = {
      id: 'foo',
      kind: 'npm',
      version: '1.0.0',
      resolution: 'npm:foo@1.0.0',
      skills: ['skills/core/SKILL.md'],
      contentHash: 'sha256-foo',
      manifestHash: null,
      capabilities: null,
    }
    const ignore: IntentLockfilePolicyIgnore = {
      id: 'ignored',
      scope: { source: 'npm:foo', contentHash: 'sha256-foo' },
      reason: 'reviewed',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    }
    const policy: IntentLockfilePolicy = { ignores: [ignore] }
    const baseline: IntentLockfileStalenessBaseline = {
      kind: 'tag',
      ref: 'v1.0.0',
      commit: 'abc123',
    }
    const staleness: IntentLockfileStaleness = { baseline }
    const lockfile: IntentLockfile = {
      lockfileVersion: 1,
      intentVersion: '1.0.0',
      staleness,
      sources: [source],
      policy,
    }
    const result: ReadIntentLockfileResult = { status: 'found', lockfile }
    const identity: SourceIdentity = { kind: 'npm', id: 'foo' }

    expectTypeOf(result).toMatchTypeOf<ReadIntentLockfileResult>()
    expectTypeOf(identity).toMatchTypeOf<SourceIdentity>()
  })
})
