import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseIntentLockfile,
  readIntentLockfile,
  serializeIntentLockfile,
  writeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'
import type { IntentLockfile } from '../src/core/lockfile/lockfile.js'

const roots: Array<string> = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-lockfile-test-'))
  roots.push(root)
  return root
}

function createLockfile(): IntentLockfile {
  return {
    lockfileVersion: 1,
    intentVersion: '1.0.0',
    staleness: {
      baseline: {
        kind: 'tag',
        ref: 'v1.42.0',
        commit: 'abc123',
      },
    },
    sources: [
      {
        id: 'router',
        kind: 'workspace',
        version: '1.42.0',
        resolution: null,
        skills: [],
        manifestHash: null,
        contentHash: 'sha256-workspace-router',
        capabilities: null,
      },
      {
        id: '@tanstack/router',
        kind: 'npm',
        version: '1.42.0',
        resolution: 'npm:@tanstack/router@1.42.0',
        skills: [],
        manifestHash: null,
        contentHash: 'sha256-npm-router',
        capabilities: null,
      },
    ],
    policy: {
      ignores: [],
    },
  }
}

function createCanonicalLockfile(): IntentLockfile {
  return {
    ...createLockfile(),
    sources: [...createLockfile().sources].sort((a, b) =>
      `${a.kind}\u0000${a.id}` < `${b.kind}\u0000${b.id}` ? -1 : 1,
    ),
  }
}

function createUnsortedSemanticEquivalentLockfile(): IntentLockfile {
  return {
    ...createLockfile(),
    sources: [
      {
        ...createLockfile().sources[0]!,
        capabilities: ['write', 'read'],
        declaredSecrets: ['TOKEN', 'API_KEY'],
        mcpTools: ['tool-b', 'tool-a'],
        mcpPolicy: {
          zebra: { nested: { beta: true, alpha: true } },
          alpha: ['b', { z: 1, a: 2 }],
        },
      },
      createLockfile().sources[1]!,
    ],
    policy: {
      ignores: [
        {
          id: 'z-ignore',
          scope: { source: 'router', contentHash: 'sha256-z' },
          reason: 'z reason',
          createdAt: '2026-05-27T00:00:00Z',
          expiresAt: '2026-08-27',
        },
        {
          id: 'a-ignore',
          scope: { source: '@tanstack/router', contentHash: 'sha256-a' },
          reason: 'a reason',
          createdAt: '2026-05-26T00:00:00Z',
          expiresAt: '2026-08-26',
        },
      ],
    },
  }
}

function createSortedSemanticEquivalentLockfile(): IntentLockfile {
  return {
    ...createLockfile(),
    sources: [
      createLockfile().sources[1]!,
      {
        ...createLockfile().sources[0]!,
        capabilities: ['read', 'write'],
        declaredSecrets: ['API_KEY', 'TOKEN'],
        mcpTools: ['tool-a', 'tool-b'],
        mcpPolicy: {
          alpha: ['b', { a: 2, z: 1 }],
          zebra: { nested: { alpha: true, beta: true } },
        },
      },
    ],
    policy: {
      ignores: [
        {
          id: 'a-ignore',
          scope: { source: '@tanstack/router', contentHash: 'sha256-a' },
          reason: 'a reason',
          createdAt: '2026-05-26T00:00:00Z',
          expiresAt: '2026-08-26',
        },
        {
          id: 'z-ignore',
          scope: { source: 'router', contentHash: 'sha256-z' },
          reason: 'z reason',
          createdAt: '2026-05-27T00:00:00Z',
          expiresAt: '2026-08-27',
        },
      ],
    },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('serializeIntentLockfile', () => {
  it('serializes sources in stable identity order', () => {
    expect(serializeIntentLockfile(createLockfile())).toMatch(
      /"id": "@tanstack\/router"[\s\S]+"id": "router"/,
    )
  })

  it('omits generation timestamps', () => {
    expect(serializeIntentLockfile(createLockfile())).not.toMatch(
      /generated(?:At|On)/,
    )
  })

  it('serializes byte-identically for the same semantic input', () => {
    expect(
      serializeIntentLockfile(createUnsortedSemanticEquivalentLockfile()),
    ).toBe(serializeIntentLockfile(createSortedSemanticEquivalentLockfile()))
  })
})

describe('parseIntentLockfile', () => {
  it('parses a serialized lockfile', () => {
    expect(
      parseIntentLockfile(serializeIntentLockfile(createLockfile())),
    ).toEqual(createCanonicalLockfile())
  })

  it('rejects an unsupported lockfile version', () => {
    expect(() =>
      parseIntentLockfile(
        JSON.stringify({ ...createLockfile(), lockfileVersion: 2 }),
      ),
    ).toThrow('Unsupported intent.lock version: 2')
  })
})

describe('readIntentLockfile', () => {
  it('reports a missing lockfile without throwing', () => {
    expect(readIntentLockfile(join(createRoot(), 'intent.lock'))).toEqual({
      status: 'missing',
    })
  })

  it('reads an existing lockfile', () => {
    const filePath = join(createRoot(), 'intent.lock')
    writeIntentLockfile(filePath, createLockfile())

    expect(readIntentLockfile(filePath)).toEqual({
      status: 'found',
      lockfile: createCanonicalLockfile(),
    })
  })
})

describe('writeIntentLockfile', () => {
  it('writes deterministic lockfile content', () => {
    const root = createRoot()
    const filePath = join(root, 'nested', 'intent.lock')

    writeIntentLockfile(filePath, createLockfile())

    expect(readFileSync(filePath, 'utf8')).toBe(
      serializeIntentLockfile(createLockfile()),
    )
  })
})
