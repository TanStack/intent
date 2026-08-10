import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalIntentLockfile,
  parseIntentLockfile,
  readIntentLockfile,
  serializeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'
import type { IntentLockfile } from '../src/core/lockfile/lockfile.js'

const HASH_A = `sha256-${'a'.repeat(64)}`
const HASH_B = `sha256-${'b'.repeat(64)}`

function validLockfile(): IntentLockfile {
  return {
    lockfileVersion: 1,
    sources: [
      {
        kind: 'npm',
        id: 'pkg',
        observedVersion: '1.0.0',
        skills: [{ path: 'skills/a.md', contentHash: HASH_A }],
      },
    ],
  }
}

describe('intent.lock canonical form', () => {
  it('parses semantically valid noncanonical JSON', () => {
    const lockfile = parseIntentLockfile(
      '{ "sources" : [ { "skills":[], "observedVersion":"", "id":"pkg", "kind":"workspace" } ], "lockfileVersion":1 }',
    )

    expect(lockfile).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'workspace',
          id: 'pkg',
          observedVersion: '',
          skills: [],
        },
      ],
    })
  })

  it('sorts and serializes deterministically without mutating input', () => {
    const lockfile: IntentLockfile = {
      lockfileVersion: 1,
      sources: [
        {
          kind: 'workspace',
          id: 'pkg',
          observedVersion: '',
          skills: [
            { path: 'skills/z.md', contentHash: HASH_B },
            { path: 'skills/a.md', contentHash: HASH_A },
          ],
        },
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          skills: [{ path: 'skills/b.md', contentHash: HASH_B }],
        },
      ],
    }
    const original = structuredClone(lockfile)

    expect(canonicalIntentLockfile(lockfile)).toEqual({
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          skills: [{ path: 'skills/b.md', contentHash: HASH_B }],
        },
        {
          kind: 'workspace',
          id: 'pkg',
          observedVersion: '',
          skills: [
            { path: 'skills/a.md', contentHash: HASH_A },
            { path: 'skills/z.md', contentHash: HASH_B },
          ],
        },
      ],
    })
    expect(serializeIntentLockfile(lockfile)).toBe(`{
  "lockfileVersion": 1,
  "sources": [
    {
      "kind": "npm",
      "id": "pkg",
      "observedVersion": "1.0.0",
      "skills": [
        {
          "path": "skills/b.md",
          "contentHash": "${HASH_B}"
        }
      ]
    },
    {
      "kind": "workspace",
      "id": "pkg",
      "observedVersion": "",
      "skills": [
        {
          "path": "skills/a.md",
          "contentHash": "${HASH_A}"
        },
        {
          "path": "skills/z.md",
          "contentHash": "${HASH_B}"
        }
      ]
    }
  ]
}
`)
    expect(serializeIntentLockfile(lockfile)).toBe(
      serializeIntentLockfile(lockfile),
    )
    expect(lockfile).toEqual(original)
  })

  it('accepts empty sources and empty skills', () => {
    expect(parseIntentLockfile('{"lockfileVersion":1,"sources":[]}')).toEqual({
      lockfileVersion: 1,
      sources: [],
    })
    expect(
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"npm","id":"pkg","observedVersion":"1.0.0","skills":[]}]}',
      ),
    ).toMatchObject({ sources: [{ skills: [] }] })
  })

  it('keeps npm and workspace sources with the same id distinct', () => {
    expect(
      parseIntentLockfile(
        '{"lockfileVersion":1,"sources":[{"kind":"npm","id":"pkg","observedVersion":"1.0.0","skills":[]},{"kind":"workspace","id":"pkg","observedVersion":"","skills":[]}]}',
      ).sources,
    ).toHaveLength(2)
  })

  it('uses code-unit ordering for sources and skills', () => {
    const lockfile: IntentLockfile = {
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'a',
          observedVersion: '1.0.0',
          skills: [],
        },
        {
          kind: 'npm',
          id: 'Z',
          observedVersion: '1.0.0',
          skills: [
            { path: 'skills/a.md', contentHash: HASH_A },
            { path: 'skills/Z.md', contentHash: HASH_B },
          ],
        },
      ],
    }

    const canonical = canonicalIntentLockfile(lockfile)

    expect(canonical.sources.map((source) => source.id)).toEqual(['Z', 'a'])
    expect(canonical.sources[0]!.skills.map((skill) => skill.path)).toEqual([
      'skills/Z.md',
      'skills/a.md',
    ])
  })
})

describe('intent.lock schema', () => {
  it.each([
    ['root', { ...validLockfile(), extra: true }],
    [
      'source',
      {
        lockfileVersion: 1,
        sources: [{ ...validLockfile().sources[0]!, extra: true }],
      },
    ],
    [
      'skill',
      {
        lockfileVersion: 1,
        sources: [
          {
            ...validLockfile().sources[0]!,
            skills: [
              {
                ...validLockfile().sources[0]!.skills[0]!,
                extra: true,
              },
            ],
          },
        ],
      },
    ],
  ])('rejects unknown fields at the %s level', (_level, value) => {
    expect(() => parseIntentLockfile(JSON.stringify(value))).toThrow(
      'unknown field: extra',
    )
  })

  it('rejects unknown runtime fields during canonicalization', () => {
    const lockfile = { ...validLockfile(), extra: true } as IntentLockfile

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'unknown field: extra',
    )
  })

  it('rejects inherited required fields during canonicalization', () => {
    const lockfile = Object.assign(Object.create({ lockfileVersion: 1 }), {
      sources: [],
    }) as IntentLockfile

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'missing field: lockfileVersion',
    )
  })

  it.each([
    ['root null', null],
    ['root array', []],
    ['missing lockfileVersion', { sources: [] }],
    ['missing sources', { lockfileVersion: 1 }],
    ['string lockfileVersion', { lockfileVersion: '1', sources: [] }],
    ['object sources', { lockfileVersion: 1, sources: {} }],
    ['null source', { lockfileVersion: 1, sources: [null] }],
    ['array source', { lockfileVersion: 1, sources: [[]] }],
    [
      'missing source kind',
      {
        lockfileVersion: 1,
        sources: [{ id: 'pkg', observedVersion: '1.0.0', skills: [] }],
      },
    ],
    [
      'missing source id',
      {
        lockfileVersion: 1,
        sources: [{ kind: 'npm', observedVersion: '1.0.0', skills: [] }],
      },
    ],
    [
      'missing observedVersion',
      {
        lockfileVersion: 1,
        sources: [{ kind: 'npm', id: 'pkg', skills: [] }],
      },
    ],
    [
      'missing source skills',
      {
        lockfileVersion: 1,
        sources: [{ kind: 'npm', id: 'pkg', observedVersion: '1.0.0' }],
      },
    ],
    [
      'number source id',
      {
        lockfileVersion: 1,
        sources: [{ kind: 'npm', id: 1, observedVersion: '1.0.0', skills: [] }],
      },
    ],
    [
      'number observedVersion',
      {
        lockfileVersion: 1,
        sources: [{ kind: 'npm', id: 'pkg', observedVersion: 1, skills: [] }],
      },
    ],
    [
      'object source skills',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: {},
          },
        ],
      },
    ],
    [
      'null skill',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [null],
          },
        ],
      },
    ],
    [
      'array skill',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [[]],
          },
        ],
      },
    ],
    [
      'missing skill path',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ contentHash: HASH_A }],
          },
        ],
      },
    ],
    [
      'missing skill contentHash',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ path: 'skills/a.md' }],
          },
        ],
      },
    ],
    [
      'number skill path',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ path: 1, contentHash: HASH_A }],
          },
        ],
      },
    ],
    [
      'number skill contentHash',
      {
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ path: 'skills/a.md', contentHash: 1 }],
          },
        ],
      },
    ],
  ])('rejects an invalid or missing field: %s', (_case, value) => {
    expect(() => parseIntentLockfile(JSON.stringify(value))).toThrow()
  })

  it.each([2, 10])(
    'gives future lockfile versions an upgrade message',
    (version) => {
      expect(() =>
        parseIntentLockfile(
          JSON.stringify({ lockfileVersion: version, sources: [] }),
        ),
      ).toThrow('requires a newer version of @tanstack/intent')
    },
  )

  it.each([0, -1, 1.5])(
    'rejects another non-v1 lockfile version',
    (version) => {
      expect(() =>
        parseIntentLockfile(
          JSON.stringify({ lockfileVersion: version, sources: [] }),
        ),
      ).toThrow('lockfileVersion must be 1')
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite runtime lockfile version',
    (version) => {
      const lockfile = validLockfile() as { lockfileVersion: number }
      lockfile.lockfileVersion = version

      expect(() => canonicalIntentLockfile(lockfile as IntentLockfile)).toThrow(
        'lockfileVersion must be 1',
      )
    },
  )

  it('rejects JSONC comments and trailing commas', () => {
    expect(() =>
      parseIntentLockfile('{"lockfileVersion":1,"sources":[] // comment\n}'),
    ).toThrow()
    expect(() =>
      parseIntentLockfile('{"lockfileVersion":1,"sources":[],}'),
    ).toThrow()
  })

  it('rejects invalid source kinds', () => {
    const lockfile = validLockfile()
    const source = lockfile.sources[0] as unknown as { kind: string }
    source.kind = 'git'

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'kind must be npm or workspace',
    )
  })

  it('rejects duplicate source identities', () => {
    const lockfile = validLockfile()
    lockfile.sources.push(structuredClone(lockfile.sources[0]!))

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'Duplicate source: npm:pkg',
    )
  })

  it('rejects duplicate skill paths within a source', () => {
    const lockfile = validLockfile()
    lockfile.sources[0]!.skills.push({
      path: 'skills/a.md',
      contentHash: HASH_B,
    })

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'Duplicate skill path: skills/a.md',
    )
  })

  it('rejects invalid skill paths', () => {
    const lockfile = validLockfile()
    lockfile.sources[0]!.skills[0]!.path = '../outside.md'

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'Skill path must not contain . or .. segments',
    )
  })

  it.each([
    'a'.repeat(64),
    `sha256-${'a'.repeat(63)}`,
    `sha256-${'a'.repeat(65)}`,
    `sha256-${'A'.repeat(64)}`,
    `sha512-${'a'.repeat(64)}`,
  ])('rejects a noncanonical content hash', (contentHash) => {
    const lockfile = validLockfile()
    lockfile.sources[0]!.skills[0]!.contentHash = contentHash

    expect(() => canonicalIntentLockfile(lockfile)).toThrow(
      'contentHash must be sha256- followed by 64 lowercase hex characters',
    )
  })
})

describe('intent.lock source fields', () => {
  it('enforces source id UTF-8 bounds and non-empty values', () => {
    const exact = validLockfile()
    exact.sources[0]!.id = 'a'.repeat(214)
    expect(() => canonicalIntentLockfile(exact)).not.toThrow()

    for (const id of ['', 'a'.repeat(215), '\u00e9'.repeat(108)]) {
      const lockfile = validLockfile()
      lockfile.sources[0]!.id = id
      expect(() => canonicalIntentLockfile(lockfile)).toThrow()
    }
  })

  it('enforces observedVersion semantics and UTF-8 bounds', () => {
    const exact = validLockfile()
    exact.sources[0]!.observedVersion = 'a'.repeat(256)
    expect(() => canonicalIntentLockfile(exact)).not.toThrow()

    const workspace = validLockfile()
    workspace.sources[0]!.kind = 'workspace'
    workspace.sources[0]!.observedVersion = ''
    expect(() => canonicalIntentLockfile(workspace)).not.toThrow()

    for (const observedVersion of ['', 'a'.repeat(257), '\u00e9'.repeat(129)]) {
      const lockfile = validLockfile()
      lockfile.sources[0]!.observedVersion = observedVersion
      expect(() => canonicalIntentLockfile(lockfile)).toThrow()
    }
  })

  it.each([
    '\u001f',
    '\u007f',
    '\u009f',
    '\u061c',
    '\u200e',
    '\u200f',
    '\u202e',
    '\u2066',
  ])(
    'rejects controls and bidi controls in source fields',
    (control) => {
      const idLockfile = validLockfile()
      idLockfile.sources[0]!.id = `pkg${control}`
      expect(() => canonicalIntentLockfile(idLockfile)).toThrow()

      const versionLockfile = validLockfile()
      versionLockfile.sources[0]!.observedVersion = `1${control}`
      expect(() => canonicalIntentLockfile(versionLockfile)).toThrow()
    },
  )
})

describe('intent.lock duplicate object keys', () => {
  it.each([
    ['root', '{"lockfileVersion":1,"sources":[],"sources":[]}', 'sources'],
    [
      'source',
      '{"lockfileVersion":1,"sources":[{"kind":"npm","id":"one","id":"two","observedVersion":"1.0.0","skills":[]}]}',
      'id',
    ],
    [
      'skill',
      `{"lockfileVersion":1,"sources":[{"kind":"npm","id":"pkg","observedVersion":"1.0.0","skills":[{"path":"skills/a.md","p\\u0061th":"skills/b.md","contentHash":"${HASH_A}"}]}]}`,
      'path',
    ],
  ])('rejects duplicate keys at the %s level', (_level, content, key) => {
    expect(() => parseIntentLockfile(content)).toThrow(
      `Duplicate object key: ${key}`,
    )
  })
})

describe('readIntentLockfile', () => {
  const tempDirs: Array<string> = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'intent-lockfile-'))
    tempDirs.push(root)
    return root
  }

  it('reads and parses a bounded regular file', () => {
    const path = join(tempRoot(), 'intent.lock')
    writeFileSync(path, serializeIntentLockfile(validLockfile()), 'utf8')

    expect(readIntentLockfile(path)).toEqual({
      status: 'found',
      lockfile: validLockfile(),
    })
  })

  it('returns missing only when the path does not exist', () => {
    const path = join(tempRoot(), 'missing.lock')

    expect(readIntentLockfile(path)).toEqual({ status: 'missing' })
  })

  it('rejects invalid content in a regular file', () => {
    const path = join(tempRoot(), 'intent.lock')
    writeFileSync(path, 'not JSON', 'utf8')

    expect(() => readIntentLockfile(path)).toThrow()
  })

  it('rejects invalid UTF-8 bytes before parsing JSON', () => {
    const path = join(tempRoot(), 'intent.lock')
    const content = Buffer.concat([
      Buffer.from('{"lockfileVersion":1,"sources":[{"kind":"npm","id":"'),
      Buffer.from([0xff]),
      Buffer.from('","observedVersion":"1.0.0","skills":[]}]}'),
    ])
    writeFileSync(path, content)

    expect(() => readIntentLockfile(path)).toThrow()
  })

  it('rejects non-regular files', () => {
    expect(() => readIntentLockfile(tempRoot())).toThrow(
      'intent.lock must be a regular file',
    )
  })

  it('rejects symbolic links', () => {
    const root = tempRoot()
    const target = join(root, 'target.lock')
    const link = join(root, 'intent.lock')
    writeFileSync(target, serializeIntentLockfile(validLockfile()), 'utf8')
    symlinkSync(target, link)

    expect(() => readIntentLockfile(link)).toThrow(
      'intent.lock must not be a symbolic link',
    )
  })

  it('rejects files larger than 1 MiB', () => {
    const path = join(tempRoot(), 'intent.lock')
    writeFileSync(path, Buffer.alloc(1024 * 1024 + 1, 0x20))

    expect(() => readIntentLockfile(path)).toThrow(
      'intent.lock exceeds the 1 MiB limit',
    )
  })
})
