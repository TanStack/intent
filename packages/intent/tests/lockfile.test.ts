import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseIntentLockfile,
  readIntentLockfile,
  serializeIntentLockfile,
  writeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'

const roots: Array<string> = []

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'intent-lockfile-'))
  roots.push(path)
  return path
}

afterEach(() => {
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }))
})

describe('intent lockfile', () => {
  it('serializes sources and skills in ordinal order', () => {
    const serialized = serializeIntentLockfile({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'workspace',
          id: 'z',
          skills: [{ path: 'skills/z', contentHash: 'sha256-z' }],
        },
        {
          kind: 'npm',
          id: 'a',
          skills: [
            { path: 'skills/z', contentHash: 'sha256-z' },
            { path: 'skills/a', contentHash: 'sha256-a' },
          ],
        },
      ],
    })

    expect(serialized).toBe(
      `${JSON.stringify(
        {
          lockfileVersion: 1,
          sources: [
            {
              kind: 'npm',
              id: 'a',
              skills: [
                { path: 'skills/a', contentHash: 'sha256-a' },
                { path: 'skills/z', contentHash: 'sha256-z' },
              ],
            },
            {
              kind: 'workspace',
              id: 'z',
              skills: [{ path: 'skills/z', contentHash: 'sha256-z' }],
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
  })

  it('rejects undeclared fields, invalid source identity, and duplicate paths', () => {
    expect(() =>
      parseIntentLockfile('{"lockfileVersion":1,"sources":[],"extra":true}'),
    ).toThrow()
    expect(() =>
      parseIntentLockfile('{"lockfileVersion":2,"sources":[]}'),
    ).toThrow()
    expect(() =>
      parseIntentLockfile('{"lockfileVersion":1,"sources":"bad"}'),
    ).toThrow()
    expect(() =>
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"git","id":"a","skills":[]}]}',
      ),
    ).toThrow()
    expect(() =>
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"npm","id":"a","skills":[]},{"kind":"npm","id":"a","skills":[]}]}',
      ),
    ).toThrow()
    expect(() =>
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"npm","id":"a","skills":[{"path":"skills/a","contentHash":"x"},{"path":"skills/a","contentHash":"y"}]}]}',
      ),
    ).toThrow()
    expect(() =>
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"npm","id":"a","skills":[{"path":"../skills/a","contentHash":"x"}]}]}',
      ),
    ).toThrow()
  })

  it('names an upgrade path for lockfiles a newer Intent wrote', () => {
    expect(() =>
      parseIntentLockfile('{"lockfileVersion":2,"sources":[]}'),
    ).toThrow(/lockfileVersion 2.*Upgrade @tanstack\/intent/s)
    expect(() =>
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"git","id":"a","skills":[]}]}',
      ),
    ).toThrow(/contains a "git" source.*Upgrade @tanstack\/intent/s)
  })

  it('reads missing locks and atomically writes canonical content', () => {
    const path = join(root(), 'nested', 'intent.lock')
    expect(readIntentLockfile(path)).toEqual({ status: 'missing' })
    writeIntentLockfile(path, { lockfileVersion: 1, sources: [] })
    writeIntentLockfile(path, {
      lockfileVersion: 1,
      sources: [{ kind: 'npm', id: 'example', skills: [] }],
    })
    expect(readIntentLockfile(path)).toEqual({
      status: 'found',
      lockfile: {
        lockfileVersion: 1,
        sources: [{ kind: 'npm', id: 'example', skills: [] }],
      },
    })
    expect(readFileSync(path, 'utf8')).toContain('"id": "example"')
  })
})
