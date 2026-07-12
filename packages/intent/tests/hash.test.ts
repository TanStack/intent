import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HASH_LIMITS,
  computeSkillFolderHash,
  computeSourceContentHash,
} from '../src/core/lockfile/hash.js'

const roots: Array<string> = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-hash-test-'))
  roots.push(root)
  return root
}

function writeFile(
  dir: string,
  relativePath: string,
  content: string | Buffer,
): string {
  const filePath = join(dir, relativePath)
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content)
  return filePath
}

function sourceHash(root: string, skillPath: string): string {
  return computeSourceContentHash(root, [
    { relativePath: 'skills/a/SKILL.md', absolutePath: skillPath },
  ]).contentHash
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('computeSourceContentHash', () => {
  it('is deterministic for the same file set', () => {
    const root = createRoot()
    writeFile(root, 'skills/a/SKILL.md', 'hello')
    writeFile(root, 'skills/b/SKILL.md', 'world')
    const entries = [
      {
        relativePath: 'skills/a/SKILL.md',
        absolutePath: join(root, 'skills/a/SKILL.md'),
      },
      {
        relativePath: 'skills/b/SKILL.md',
        absolutePath: join(root, 'skills/b/SKILL.md'),
      },
    ]

    expect(computeSourceContentHash(root, entries)).toEqual(
      computeSourceContentHash(root, entries),
    )
  })

  it('is independent of input array order', () => {
    const root = createRoot()
    writeFile(root, 'skills/a/SKILL.md', 'hello')
    writeFile(root, 'skills/b/SKILL.md', 'world')
    const a = {
      relativePath: 'skills/a/SKILL.md',
      absolutePath: join(root, 'skills/a/SKILL.md'),
    }
    const b = {
      relativePath: 'skills/b/SKILL.md',
      absolutePath: join(root, 'skills/b/SKILL.md'),
    }

    expect(computeSourceContentHash(root, [a, b]).contentHash).toBe(
      computeSourceContentHash(root, [b, a]).contentHash,
    )
  })

  it('sorts the returned skills[] ordinally regardless of input order', () => {
    const root = createRoot()
    writeFile(root, 'skills/b/SKILL.md', 'b')
    writeFile(root, 'skills/a/SKILL.md', 'a')
    const entries = [
      {
        relativePath: 'skills/b/SKILL.md',
        absolutePath: join(root, 'skills/b/SKILL.md'),
      },
      {
        relativePath: 'skills/a/SKILL.md',
        absolutePath: join(root, 'skills/a/SKILL.md'),
      },
    ]

    expect(computeSourceContentHash(root, entries).skills).toEqual([
      'skills/a/SKILL.md',
      'skills/b/SKILL.md',
    ])
  })

  it('changes when file content changes', () => {
    const root = createRoot()
    const filePath = writeFile(root, 'skills/a/SKILL.md', 'hello')
    const entries = [
      { relativePath: 'skills/a/SKILL.md', absolutePath: filePath },
    ]
    const before = computeSourceContentHash(root, entries).contentHash

    writeFileSync(filePath, 'hello!')

    expect(computeSourceContentHash(root, entries).contentHash).not.toBe(before)
  })

  it('changes when a file is renamed with the same content', () => {
    const root = createRoot()
    const path1 = writeFile(root, 'skills/a/SKILL.md', 'hello')
    const path2 = writeFile(root, 'skills/b/SKILL.md', 'hello')

    const original = computeSourceContentHash(root, [
      { relativePath: 'skills/a/SKILL.md', absolutePath: path1 },
    ])
    const renamed = computeSourceContentHash(root, [
      { relativePath: 'skills/b/SKILL.md', absolutePath: path2 },
    ])

    expect(original.contentHash).not.toBe(renamed.contentHash)
  })

  it('does not collide across a path/content boundary shift', () => {
    const root = createRoot()
    const pathA = writeFile(root, 'a', 'bc')
    const pathB = writeFile(root, 'ab', 'c')

    const hashA = computeSourceContentHash(root, [
      { relativePath: 'a', absolutePath: pathA },
    ]).contentHash
    const hashB = computeSourceContentHash(root, [
      { relativePath: 'ab', absolutePath: pathB },
    ]).contentHash

    expect(hashA).not.toBe(hashB)
  })

  it('returns a sha256- prefixed digest, including for an empty skill set', () => {
    const root = createRoot()
    expect(computeSourceContentHash(root, []).contentHash).toMatch(
      /^sha256-[0-9a-f]{64}$/,
    )
  })

  it('rejects duplicate relative paths', () => {
    const root = createRoot()
    const filePath = writeFile(root, 'SKILL.md', 'a')

    expect(() =>
      computeSourceContentHash(root, [
        { relativePath: 'SKILL.md', absolutePath: filePath },
        { relativePath: 'SKILL.md', absolutePath: filePath },
      ]),
    ).toThrow(/duplicate path/)
  })

  it('rejects an absolute relative path', () => {
    const root = createRoot()
    const filePath = writeFile(root, 'SKILL.md', 'a')

    expect(() =>
      computeSourceContentHash(root, [
        { relativePath: '/etc/passwd', absolutePath: filePath },
      ]),
    ).toThrow(/must be relative/)
  })

  it("rejects a path containing a '..' segment", () => {
    const root = createRoot()
    const filePath = writeFile(root, 'SKILL.md', 'a')

    expect(() =>
      computeSourceContentHash(root, [
        { relativePath: '../outside.md', absolutePath: filePath },
      ]),
    ).toThrow(/segments/)
  })

  it('rejects a relative path containing an embedded NUL byte', () => {
    const root = createRoot()
    const filePath = writeFile(root, 'SKILL.md', 'a')

    expect(() =>
      computeSourceContentHash(root, [
        { relativePath: 'assets/a\0b.md', absolutePath: filePath },
      ]),
    ).toThrow(/NUL byte/)
  })

  it('normalizes CRLF and lone CR to LF in text content', () => {
    const root = createRoot()
    const filePath = writeFile(
      root,
      'SKILL.md',
      Buffer.from('line1\r\nline2\rline3\n'),
    )
    const normalized = computeSourceContentHash(root, [
      { relativePath: 'SKILL.md', absolutePath: filePath },
    ])
    const already = computeSourceContentHash(root, [
      {
        relativePath: 'SKILL.md',
        absolutePath: writeFile(
          root,
          'already-lf/SKILL.md',
          'line1\nline2\nline3\n',
        ),
      },
    ])

    expect(normalized.contentHash).toBe(already.contentHash)
  })

  it('classifies a large buffer with a NUL byte past the first bytes as binary (no CRLF normalization)', () => {
    const root = createRoot()
    const content = Buffer.concat([
      Buffer.alloc(9000, 0x41),
      Buffer.from([0x00]),
      Buffer.from('\r\n'),
    ])
    const filePath = writeFile(root, 'SKILL.md', content)

    expect(
      computeSourceContentHash(root, [
        { relativePath: 'SKILL.md', absolutePath: filePath },
      ]).contentHash,
    ).toMatch(/^sha256-[0-9a-f]{64}$/)
  })

  it('keeps non-UTF-8 binary bytes exact when no NUL byte is present', () => {
    const root = createRoot()
    const filePath = writeFile(
      root,
      'assets/data.bin',
      Buffer.from([0xff, 0x0d, 0x0a]),
    )
    const entries = [
      { relativePath: 'assets/data.bin', absolutePath: filePath },
    ]
    const withCrLf = computeSourceContentHash(root, entries).contentHash

    writeFileSync(filePath, Buffer.from([0xff, 0x0a]))

    expect(computeSourceContentHash(root, entries).contentHash).not.toBe(
      withCrLf,
    )
  })

  it('is identical across different physical roots for identical relative paths and bytes', () => {
    const rootA = createRoot()
    const rootB = createRoot()
    const pathA = writeFile(rootA, 'skills/a/SKILL.md', 'shared body')
    const pathB = writeFile(rootB, 'skills/a/SKILL.md', 'shared body')

    const hashA = computeSourceContentHash(rootA, [
      { relativePath: 'skills/a/SKILL.md', absolutePath: pathA },
    ]).contentHash
    const hashB = computeSourceContentHash(rootB, [
      { relativePath: 'skills/a/SKILL.md', absolutePath: pathB },
    ]).contentHash

    expect(hashA).toBe(hashB)
  })

  it('hashes a reference file in a skill folder', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    writeFile(root, 'skills/a/references/deep-dive.md', 'reference')

    const before = computeSourceContentHash(root, [
      { relativePath: 'skills/a/SKILL.md', absolutePath: skillPath },
    ]).contentHash

    writeFileSync(join(root, 'skills/a/references/deep-dive.md'), 'changed')

    expect(
      computeSourceContentHash(root, [
        { relativePath: 'skills/a/SKILL.md', absolutePath: skillPath },
      ]).contentHash,
    ).not.toBe(before)
  })

  it.each([
    ['references', 'deep-dive.md'],
    ['assets', 'fixture.bin'],
    ['scripts', 'run.mjs'],
  ] as const)(
    'changes when a %s file is modified, added, removed, or renamed',
    (directory, fileName) => {
      const root = createRoot()
      const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
      const supportPath = `skills/a/${directory}/${fileName}`
      const renamedPath = `skills/a/${directory}/renamed-${fileName}`
      writeFile(root, supportPath, 'original')
      const before = sourceHash(root, skillPath)

      writeFile(root, supportPath, 'modified')
      expect(sourceHash(root, skillPath)).not.toBe(before)

      writeFile(root, supportPath, 'original')
      writeFile(root, `skills/a/${directory}/added-${fileName}`, 'added')
      expect(sourceHash(root, skillPath)).not.toBe(before)

      rmSync(join(root, `skills/a/${directory}/added-${fileName}`))
      rmSync(join(root, supportPath))
      expect(sourceHash(root, skillPath)).not.toBe(before)

      writeFile(root, supportPath, 'original')
      renameSync(join(root, supportPath), join(root, renamedPath))
      expect(sourceHash(root, skillPath)).not.toBe(before)
    },
  )

  it('keeps binary supporting-file bytes exact', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    const assetPath = writeFile(
      root,
      'skills/a/assets/data.bin',
      Buffer.from([0x00, 0x0d, 0x0a, 0xff]),
    )
    const before = sourceHash(root, skillPath)

    writeFileSync(assetPath, Buffer.from([0x00, 0x0a, 0xff]))

    expect(sourceHash(root, skillPath)).not.toBe(before)
  })

  it('rejects support directories beyond the recursion depth limit', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    let nestedDir = 'skills/a/references'
    for (let index = 0; index <= HASH_LIMITS.maxRecursionDepth; index++) {
      nestedDir = join(nestedDir, `level-${index}`)
    }
    writeFile(root, join(nestedDir, 'note.md'), 'content')

    expect(() => sourceHash(root, skillPath)).toThrow(/recursion depth limit/)
  })

  it('rejects support file sets beyond the file count limit', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    for (let index = 0; index < HASH_LIMITS.maxFileCount; index++) {
      writeFile(root, `skills/a/assets/file-${index}.txt`, 'content')
    }

    expect(() => sourceHash(root, skillPath)).toThrow(/file count limit/)
  })

  it('rejects support directory sets beyond the entry count limit', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    for (let index = 0; index <= HASH_LIMITS.maxEntryCount; index++) {
      mkdirSync(join(root, `skills/a/assets/empty-${index}`), {
        recursive: true,
      })
    }

    expect(() => sourceHash(root, skillPath)).toThrow(/entry count limit/)
  })

  it('rejects files beyond the per-file size limit for source and manifest hashes', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    writeFile(
      root,
      'skills/a/assets/large.bin',
      Buffer.alloc(HASH_LIMITS.maxFileBytes + 1),
    )

    expect(() => sourceHash(root, skillPath)).toThrow(/file size limit/)
    expect(() => computeSkillFolderHash(join(root, 'skills/a'), root)).toThrow(
      /file size limit/,
    )
  })

  it('rejects content sets beyond the total size limit', () => {
    const root = createRoot()
    const skillPath = writeFile(root, 'skills/a/SKILL.md', 'body')
    const fileSize = Math.floor(HASH_LIMITS.maxFileBytes * 0.75)
    const fileCount = Math.ceil((HASH_LIMITS.maxTotalBytes + 1) / fileSize)
    for (let index = 0; index < fileCount; index++) {
      writeFile(
        root,
        `skills/a/assets/part-${index}.bin`,
        Buffer.alloc(fileSize),
      )
    }

    expect(() => sourceHash(root, skillPath)).toThrow(/total size limit/)
  })

  it('fails closed when a symlinked SKILL.md escapes the package root', () => {
    const root = createRoot()
    const outside = join(
      root,
      '..',
      'outside-' + Math.random().toString(36).slice(2),
    )
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.md'), 'leaked')
    mkdirSync(join(root, 'skills/a'), { recursive: true })
    symlinkSync(join(outside, 'secret.md'), join(root, 'skills/a/SKILL.md'))

    expect(() =>
      computeSourceContentHash(root, [
        {
          relativePath: 'skills/a/SKILL.md',
          absolutePath: join(root, 'skills/a/SKILL.md'),
        },
      ]),
    ).toThrow(/escapes the package root/)

    rmSync(outside, { recursive: true, force: true })
  })

  it('fails closed on a dangling symlink', () => {
    const root = createRoot()
    mkdirSync(join(root, 'skills/a'), { recursive: true })
    symlinkSync(
      join(root, 'skills/a', 'missing-target.md'),
      join(root, 'skills/a', 'SKILL.md'),
    )

    expect(() =>
      computeSourceContentHash(root, [
        {
          relativePath: 'skills/a/SKILL.md',
          absolutePath: join(root, 'skills/a/SKILL.md'),
        },
      ]),
    ).toThrow(/Failed to resolve skill file/)
  })

  it('follows an in-bounds symlink and hashes its target content', () => {
    const root = createRoot()
    writeFile(root, 'skills/a/canonical.md', 'shared content')
    symlinkSync(
      join(root, 'skills/a/canonical.md'),
      join(root, 'skills/a/SKILL.md'),
    )

    const direct = computeSourceContentHash(root, [
      {
        relativePath: 'skills/a/canonical.md',
        absolutePath: join(root, 'skills/a/canonical.md'),
      },
    ])
    const viaLink = computeSourceContentHash(root, [
      {
        relativePath: 'skills/a/SKILL.md',
        absolutePath: join(root, 'skills/a/SKILL.md'),
      },
    ])

    // Same bytes, different (path-included) identity — a rename/symlink
    // through a different logical path is a real content-set change (§6.4).
    expect(direct.contentHash).not.toBe(viaLink.contentHash)
  })
})
