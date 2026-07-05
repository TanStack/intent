import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hashSkillFolder,
  hashSkillFolderFiles,
  hashSourceContent,
  readSkillFolderFiles,
} from '../src/core/hash.js'

const roots: Array<string> = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-hash-test-'))
  roots.push(root)
  return root
}

function writeSkillFolder(
  dir: string,
  files: Record<string, string | Buffer>,
): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, content)
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('hashSkillFolderFiles', () => {
  it('is deterministic for the same file set', () => {
    const files = [
      { relativePath: 'SKILL.md', content: Buffer.from('hello') },
      { relativePath: 'references/a.md', content: Buffer.from('world') },
    ]

    expect(hashSkillFolderFiles(files)).toBe(hashSkillFolderFiles(files))
  })

  it('is independent of input array order', () => {
    const a = { relativePath: 'SKILL.md', content: Buffer.from('hello') }
    const b = { relativePath: 'references/a.md', content: Buffer.from('world') }

    expect(hashSkillFolderFiles([a, b])).toBe(hashSkillFolderFiles([b, a]))
  })

  it('changes when file content changes', () => {
    const base = [{ relativePath: 'SKILL.md', content: Buffer.from('hello') }]
    const changed = [
      { relativePath: 'SKILL.md', content: Buffer.from('hello!') },
    ]

    expect(hashSkillFolderFiles(base)).not.toBe(hashSkillFolderFiles(changed))
  })

  it('changes when a file is renamed with the same content', () => {
    const original = [
      { relativePath: 'SKILL.md', content: Buffer.from('hello') },
    ]
    const renamed = [
      { relativePath: 'SKILL2.md', content: Buffer.from('hello') },
    ]

    expect(hashSkillFolderFiles(original)).not.toBe(
      hashSkillFolderFiles(renamed),
    )
  })

  it('does not collide across a path/content boundary shift', () => {
    const a = [{ relativePath: 'a', content: Buffer.from('bc') }]
    const b = [{ relativePath: 'ab', content: Buffer.from('c') }]

    expect(hashSkillFolderFiles(a)).not.toBe(hashSkillFolderFiles(b))
  })

  it('returns a sha256- prefixed digest', () => {
    expect(hashSkillFolderFiles([])).toMatch(/^sha256-[0-9a-f]{64}$/)
  })

  it('rejects duplicate relative paths', () => {
    const files = [
      { relativePath: 'SKILL.md', content: Buffer.from('a') },
      { relativePath: 'SKILL.md', content: Buffer.from('b') },
    ]

    expect(() => hashSkillFolderFiles(files)).toThrow(/duplicate path/)
  })

  it('rejects an absolute relative path', () => {
    const files = [{ relativePath: '/etc/passwd', content: Buffer.from('a') }]

    expect(() => hashSkillFolderFiles(files)).toThrow(/must be relative/)
  })

  it("rejects a path containing a '..' segment", () => {
    const files = [{ relativePath: '../outside.md', content: Buffer.from('a') }]

    expect(() => hashSkillFolderFiles(files)).toThrow(/segments/)
  })

  it('classifies a large buffer with a NUL byte past the first 8000 bytes as binary', () => {
    const content = Buffer.concat([
      Buffer.alloc(9000, 0x41),
      Buffer.from([0x00]),
      Buffer.from('\r\n'),
    ])
    const files = [{ relativePath: 'assets/large.bin', content }]

    expect(hashSkillFolderFiles(files)).toMatch(/^sha256-[0-9a-f]{64}$/)
  })

  it('rejects a relative path containing an embedded NUL byte', () => {
    const files = [
      { relativePath: 'assets/a\0b.md', content: Buffer.from('a') },
    ]

    expect(() => hashSkillFolderFiles(files)).toThrow(/NUL byte/)
  })
})

describe('hashSourceContent', () => {
  it('is deterministic regardless of input order', () => {
    const a = { skillPath: 'skills/a', hash: 'sha256-aaa' }
    const b = { skillPath: 'skills/b', hash: 'sha256-bbb' }

    expect(hashSourceContent([a, b])).toBe(hashSourceContent([b, a]))
  })

  it('changes when any per-skill hash changes', () => {
    const before = [{ skillPath: 'skills/a', hash: 'sha256-aaa' }]
    const after = [{ skillPath: 'skills/a', hash: 'sha256-zzz' }]

    expect(hashSourceContent(before)).not.toBe(hashSourceContent(after))
  })

  it('rejects duplicate skill paths', () => {
    const duplicates = [
      { skillPath: 'skills/a', hash: 'sha256-aaa' },
      { skillPath: 'skills/a', hash: 'sha256-bbb' },
    ]

    expect(() => hashSourceContent(duplicates)).toThrow(/duplicate path/)
  })
})

describe('readSkillFolderFiles', () => {
  it('reads SKILL.md plus nested references/assets/scripts files', () => {
    const root = createRoot()
    writeSkillFolder(root, {
      'SKILL.md': 'body',
      'references/deep-dive.md': 'reference',
      'assets/notes.txt': 'asset',
      'scripts/setup.sh': 'echo hi',
    })

    const files = readSkillFolderFiles(root)

    expect(files.map((file) => file.relativePath).sort()).toEqual([
      'SKILL.md',
      'assets/notes.txt',
      'references/deep-dive.md',
      'scripts/setup.sh',
    ])
  })

  it('normalizes CRLF and lone CR to LF in text files', () => {
    const root = createRoot()
    writeSkillFolder(root, {
      'SKILL.md': Buffer.from('line1\r\nline2\rline3\n'),
    })

    const [file] = readSkillFolderFiles(root)

    expect(file!.content.toString('utf8')).toBe('line1\nline2\nline3\n')
  })

  it('leaves binary content byte-exact', () => {
    const root = createRoot()
    const binary = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0x01])
    writeSkillFolder(root, { 'assets/image.bin': binary })

    const [file] = readSkillFolderFiles(root)

    expect(file!.content.equals(binary)).toBe(true)
  })

  it('uses forward-slash relative paths regardless of platform separator', () => {
    const root = createRoot()
    writeSkillFolder(root, { 'references/nested/deep.md': 'content' })

    const files = readSkillFolderFiles(root)

    expect(files.some((file) => file.relativePath.includes('\\'))).toBe(false)
    expect(
      files.some((file) => file.relativePath === 'references/nested/deep.md'),
    ).toBe(true)
  })

  it('fails closed when a symlink escapes the skill folder', () => {
    const root = createRoot()
    const outside = join(
      root,
      '..',
      'outside-' + Math.random().toString(36).slice(2),
    )
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.md'), 'leaked')
    mkdirSync(join(root, 'references'), { recursive: true })
    symlinkSync(
      join(outside, 'secret.md'),
      join(root, 'references', 'linked.md'),
    )

    expect(() => readSkillFolderFiles(root)).toThrow(/escapes the skill folder/)

    rmSync(outside, { recursive: true, force: true })
  })

  it('fails closed when a symlinked directory escapes the skill folder', () => {
    const root = createRoot()
    const outside = join(
      root,
      '..',
      'outside-dir-' + Math.random().toString(36).slice(2),
    )
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.md'), 'leaked')
    symlinkSync(outside, join(root, 'linked-dir'), 'dir')

    expect(() => readSkillFolderFiles(root)).toThrow(/escapes the skill folder/)

    rmSync(outside, { recursive: true, force: true })
  })

  it('fails closed on a dangling symlink', () => {
    const root = createRoot()
    symlinkSync(join(root, 'missing-target.md'), join(root, 'broken.md'))

    expect(() => readSkillFolderFiles(root)).toThrow(
      /Failed to resolve skill folder symlink/,
    )
  })

  it('fails closed on a symlink cycle', () => {
    const root = createRoot()
    mkdirSync(join(root, 'a'))
    symlinkSync(root, join(root, 'a', 'back-to-root'), 'dir')

    expect(() => readSkillFolderFiles(root)).toThrow(/symlink cycle/)
  })

  it('follows an in-bounds symlink and hashes its target content', () => {
    const root = createRoot()
    writeFileSync(join(root, 'canonical.md'), 'shared content')
    symlinkSync(join(root, 'canonical.md'), join(root, 'link.md'))

    const files = readSkillFolderFiles(root)

    expect(files).toEqual([
      { relativePath: 'canonical.md', content: Buffer.from('shared content') },
      { relativePath: 'link.md', content: Buffer.from('shared content') },
    ])
  })
})

describe('hashSkillFolder', () => {
  it('is stable across two calls', () => {
    const root = createRoot()
    writeSkillFolder(root, { 'SKILL.md': 'body' })

    expect(hashSkillFolder(root)).toBe(hashSkillFolder(root))
  })

  it('changes when a nested reference file changes', () => {
    const root = createRoot()
    writeSkillFolder(root, {
      'SKILL.md': 'body',
      'references/a.md': 'version 1',
    })
    const before = hashSkillFolder(root)

    writeFileSync(join(root, 'references', 'a.md'), 'version 2')

    expect(hashSkillFolder(root)).not.toBe(before)
  })

  it('is identical across different physical roots for identical relative structure and bytes', () => {
    const rootA = createRoot()
    const rootB = createRoot()
    const files = {
      'SKILL.md': 'shared body',
      'references/a.md': 'shared reference',
    }
    writeSkillFolder(rootA, files)
    writeSkillFolder(rootB, files)

    expect(hashSkillFolder(rootA)).toBe(hashSkillFolder(rootB))
  })
})
