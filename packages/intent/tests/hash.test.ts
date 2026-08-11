import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SKILL_HASH_LIMITS,
  computeSkillContentHash,
} from '../src/core/lockfile/hash.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type { ReadFs } from '../src/shared/utils.js'

let packageRoot: string

beforeEach(() => {
  packageRoot = mkdtempSync(join(tmpdir(), 'intent-hash-test-'))
})

afterEach(() => {
  rmSync(packageRoot, { recursive: true, force: true })
})

function createSkill(
  name: string,
  files: ReadonlyArray<readonly [string, string | Buffer]>,
): string {
  const skillDir = join(packageRoot, 'skills', name)
  for (const [path, content] of files) {
    const filePath = join(skillDir, path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
  return skillDir
}

function hashSkill(skillDir: string): string {
  return computeSkillContentHash({ packageRoot, skillDir })
}

function tryCreateSymlink(
  target: string,
  path: string,
  type: 'file' | 'dir',
): boolean {
  try {
    symlinkSync(target, path, type)
    return true
  } catch {
    return false
  }
}

describe('computeSkillContentHash', () => {
  it('matches the pinned framing digest through an injected ReadFs', () => {
    const skillDir = join(packageRoot, 'skills', 'pinned')
    mkdirSync(join(skillDir, 'references'), { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: pinned\ndescription: Pinned hash fixture\n---\n',
    )
    writeFileSync(join(skillDir, 'references', 'zeta.md'), 'Zeta\n')
    writeFileSync(join(skillDir, 'references', 'alpha.md'), 'Alpha\r\n')

    let opendirCallCount = 0
    const injectedFs = {
      ...nodeReadFs,
      opendirSync: ((...args: Parameters<typeof opendirSync>) => {
        opendirCallCount += 1
        return opendirSync(...args)
      }) as typeof opendirSync,
    } satisfies ReadFs

    expect(
      computeSkillContentHash({
        packageRoot,
        skillDir: 'skills/pinned',
        fs: injectedFs,
      }),
    ).toBe(
      'sha256-985f0fe3329f5eb4cbf3202c9d34da0c53d404292423a15a25d914b7fadc6ce7',
    )
    expect(opendirCallCount).toBeGreaterThan(0)
  })

  it('is independent of physical file creation order', () => {
    const files = [
      ['SKILL.md', 'Root\n'],
      ['references/zeta.md', 'Zeta\n'],
      ['references/alpha.md', 'Alpha\n'],
    ] as const
    const first = createSkill('first', files)
    const second = createSkill('second', [...files].reverse())

    expect(hashSkill(first)).toBe(hashSkill(second))
  })

  it('normalizes CRLF, CR, and LF text line endings', () => {
    const createWithLineEnding = (name: string, lineEnding: string): string =>
      createSkill(name, [
        ['SKILL.md', `Root${lineEnding}`],
        ['notes.md', `Alpha${lineEnding}Beta${lineEnding}`],
      ])

    const lfHash = hashSkill(createWithLineEnding('lf', '\n'))
    expect(hashSkill(createWithLineEnding('crlf', '\r\n'))).toBe(lfHash)
    expect(hashSkill(createWithLineEnding('cr', '\r'))).toBe(lfHash)
  })

  it('preserves a valid UTF-8 BOM as content identity', () => {
    const withoutBom = createSkill('without-bom', [
      ['SKILL.md', 'Root\n'],
      ['notes.md', 'Alpha\n'],
    ])
    const withBom = createSkill('with-bom', [
      ['SKILL.md', 'Root\n'],
      [
        'notes.md',
        Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x6c, 0x70, 0x68, 0x61, 0x0a]),
      ],
    ])

    expect(hashSkill(withBom)).not.toBe(hashSkill(withoutBom))
  })

  it('preserves distinct invalid UTF-8 bytes', () => {
    const first = createSkill('binary-first', [
      ['SKILL.md', 'Root\n'],
      ['asset.bin', Buffer.from([0xff, 0x00])],
    ])
    const second = createSkill('binary-second', [
      ['SKILL.md', 'Root\n'],
      ['asset.bin', Buffer.from([0xfe, 0x00])],
    ])

    expect(hashSkill(first)).not.toBe(hashSkill(second))
  })

  it('includes empty files in the identity', () => {
    const withoutEmpty = createSkill('without-empty', [['SKILL.md', 'Root\n']])
    const withEmpty = createSkill('with-empty', [
      ['SKILL.md', 'Root\n'],
      ['empty.txt', ''],
    ])

    expect(hashSkill(withEmpty)).not.toBe(hashSkill(withoutEmpty))
  })

  it('includes arbitrary nested files and nested SKILL.md files', () => {
    const rootOnly = createSkill('root-only', [['SKILL.md', 'Root\n']])
    const nested = createSkill('nested', [
      ['SKILL.md', 'Root\n'],
      ['custom/deep/data.txt', 'Data\n'],
      ['custom/deep/SKILL.md', 'Nested\n'],
      ['top-level.bin', Buffer.from([0x00, 0x01])],
    ])

    expect(hashSkill(nested)).not.toBe(hashSkill(rootOnly))
  })

  it('changes when a file is added, removed, or renamed', () => {
    const baseline = createSkill('baseline', [
      ['SKILL.md', 'Root\n'],
      ['alpha.md', 'Alpha\n'],
      ['beta.md', 'Beta\n'],
    ])
    const added = createSkill('added', [
      ['SKILL.md', 'Root\n'],
      ['alpha.md', 'Alpha\n'],
      ['beta.md', 'Beta\n'],
      ['gamma.md', 'Gamma\n'],
    ])
    const removed = createSkill('removed', [
      ['SKILL.md', 'Root\n'],
      ['alpha.md', 'Alpha\n'],
    ])
    const renamed = createSkill('renamed', [
      ['SKILL.md', 'Root\n'],
      ['alpha.md', 'Alpha\n'],
      ['renamed.md', 'Beta\n'],
    ])
    const baselineHash = hashSkill(baseline)

    expect(hashSkill(added)).not.toBe(baselineHash)
    expect(hashSkill(removed)).not.toBe(baselineHash)
    expect(hashSkill(renamed)).not.toBe(baselineHash)
  })

  it('frames logical paths and content without concatenation ambiguity', () => {
    const first = createSkill('framing-first', [
      ['SKILL.md', 'Root\n'],
      ['a', 'bc'],
    ])
    const second = createSkill('framing-second', [
      ['SKILL.md', 'Root\n'],
      ['ab', 'c'],
    ])

    expect(hashSkill(first)).not.toBe(hashSkill(second))
  })

  it('accepts the individual file size limit and rejects one byte over', () => {
    const skillDir = createSkill('file-size', [
      ['SKILL.md', 'Root\n'],
      ['asset.bin', Buffer.alloc(SKILL_HASH_LIMITS.maxFileBytes, 0xff)],
    ])

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)

    writeFileSync(
      join(skillDir, 'asset.bin'),
      Buffer.alloc(SKILL_HASH_LIMITS.maxFileBytes + 1, 0xff),
    )
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill hash file size limit exceeded',
    )
  })

  it('accepts the total byte limit and rejects one byte over', () => {
    const fullFile = Buffer.alloc(SKILL_HASH_LIMITS.maxFileBytes, 0xff)
    const skillDir = createSkill('total-size', [
      ['SKILL.md', fullFile],
      ['one.bin', fullFile],
      ['two.bin', fullFile],
      ['three.bin', fullFile],
    ])

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)

    writeFileSync(join(skillDir, 'overflow.bin'), Buffer.from([0x00]))
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill hash total size limit exceeded',
    )
  })

  it('accepts the recursion depth limit and rejects one level over', () => {
    const exactPath = Array.from(
      { length: SKILL_HASH_LIMITS.maxRecursionDepth },
      (_, index) => `d${index}`,
    ).join('/')
    const skillDir = createSkill('depth', [
      ['SKILL.md', 'Root\n'],
      [`${exactPath}/exact.txt`, 'Exact\n'],
    ])

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)

    writeFileSync(join(skillDir, exactPath, 'one-over.txt'), 'Still exact\n')
    mkdirSync(join(skillDir, exactPath, 'too-deep'))
    writeFileSync(
      join(skillDir, exactPath, 'too-deep', 'overflow.txt'),
      'Overflow\n',
    )
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill hash recursion depth limit exceeded',
    )
  })

  it('accepts the entry count limit and rejects an extra directory entry', () => {
    const skillDir = createSkill('entry-count', [['SKILL.md', 'Root\n']])
    for (let index = 0; index < SKILL_HASH_LIMITS.maxEntryCount - 1; index++) {
      mkdirSync(join(skillDir, `directory-${index}`))
    }

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)

    mkdirSync(join(skillDir, 'directory-overflow'))
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill hash entry count limit exceeded',
    )
  })

  it('accepts 1000 files and reports entry overflow for the 1001st', () => {
    expect(SKILL_HASH_LIMITS.maxFileCount).toBe(SKILL_HASH_LIMITS.maxEntryCount)
    const files: Array<readonly [string, string]> = [['SKILL.md', 'Root\n']]
    for (let index = 0; index < SKILL_HASH_LIMITS.maxFileCount - 1; index++) {
      files.push([`file-${index}.txt`, ''])
    }
    const skillDir = createSkill('file-count', files)

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)

    writeFileSync(join(skillDir, 'file-overflow.txt'), '')
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill hash entry count limit exceeded',
    )
  })

  it('accepts the logical path byte limit and rejects one byte over', () => {
    const skillDir = createSkill('logical-path', [['SKILL.md', 'Root\n']])
    const aliases = ['a', 'b', 'c', 'd'].map((character) =>
      character.repeat(250),
    )
    let currentDirectory = skillDir
    for (const [index, alias] of aliases.entries()) {
      const target = join(packageRoot, 'logical-path-targets', String(index))
      mkdirSync(target, { recursive: true })
      try {
        symlinkSync(target, join(currentDirectory, alias))
      } catch {
        return
      }
      currentDirectory = target
    }

    const parent = aliases.join('/')
    const exactPath = `${parent}/${'e'.repeat(20)}`
    const overflowPath = `${parent}/${'f'.repeat(21)}`
    expect(Buffer.byteLength(exactPath, 'utf8')).toBe(
      SKILL_HASH_LIMITS.maxLogicalPathBytes,
    )
    writeFileSync(join(currentDirectory, 'e'.repeat(20)), 'Exact\n')

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)

    writeFileSync(join(currentDirectory, 'f'.repeat(21)), 'Overflow\n')
    expect(Buffer.byteLength(overflowPath, 'utf8')).toBe(
      SKILL_HASH_LIMITS.maxLogicalPathBytes + 1,
    )
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill hash logical path limit exceeded',
    )
  })

  it('rejects a skill root without SKILL.md', () => {
    const skillDir = join(packageRoot, 'skills', 'missing-root-file')
    mkdirSync(skillDir, { recursive: true })

    expect(() => hashSkill(skillDir)).toThrow('Skill root SKILL.md is required')
  })

  it('rejects a skill directory outside the package root', () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'intent-hash-outside-'))
    try {
      writeFileSync(join(outsideRoot, 'SKILL.md'), 'Outside\n')
      expect(() => hashSkill(outsideRoot)).toThrow(
        'Skill content escapes package root',
      )
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('rejects a non-directory skill root', () => {
    const skillFile = join(packageRoot, 'not-a-directory')
    writeFileSync(skillFile, 'File\n')

    expect(() => hashSkill(skillFile)).toThrow('Skill root must be a directory')
  })

  it('rejects noncanonical logical file names', () => {
    if (process.platform === 'win32') return
    const skillDir = createSkill('invalid-logical-names', [
      ['SKILL.md', 'Root\n'],
      ['bad\\name.md', 'Backslash\n'],
    ])

    expect(() => hashSkill(skillDir)).toThrow(
      'Skill path must be a relative POSIX path',
    )

    rmSync(join(skillDir, 'bad\\name.md'))
    writeFileSync(join(skillDir, 'bad\u202ename.md'), 'Bidi\n')
    expect(() => hashSkill(skillDir)).toThrow(
      'Skill path must not contain control characters',
    )
  })

  it.skipIf(process.platform === 'win32')('rejects special files', async () => {
    const skillDir = createSkill('special-file', [['SKILL.md', 'Root\n']])
    const server = createServer()

    try {
      const listening = once(server, 'listening')
      server.listen(join(skillDir, 'socket'))
      await listening

      expect(() => hashSkill(skillDir)).toThrow(
        'Skill content contains a special file',
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })

  it('follows an in-package file symlink under its logical alias', () => {
    const target = join(packageRoot, 'targets', 'shared.md')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'Shared\n')
    const linked = createSkill('linked-file', [['SKILL.md', 'Root\n']])
    if (!tryCreateSymlink(target, join(linked, 'alias.md'), 'file')) return
    const copied = createSkill('copied-file', [
      ['SKILL.md', 'Root\n'],
      ['alias.md', 'Shared\n'],
    ])

    expect(hashSkill(linked)).toBe(hashSkill(copied))
  })

  it('follows an in-package directory symlink under its logical alias', () => {
    const target = join(packageRoot, 'targets', 'references')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'topic.md'), 'Topic\n')
    const linked = createSkill('linked-directory', [['SKILL.md', 'Root\n']])
    if (!tryCreateSymlink(target, join(linked, 'alias'), 'dir')) return
    const copied = createSkill('copied-directory', [
      ['SKILL.md', 'Root\n'],
      ['alias/topic.md', 'Topic\n'],
    ])

    expect(hashSkill(linked)).toBe(hashSkill(copied))
  })

  it('rejects an escaping file symlink', () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'intent-hash-outside-'))
    try {
      const target = join(outsideRoot, 'outside.md')
      writeFileSync(target, 'Outside\n')
      const skillDir = createSkill('escaping-file', [['SKILL.md', 'Root\n']])
      if (!tryCreateSymlink(target, join(skillDir, 'outside.md'), 'file'))
        return

      expect(() => hashSkill(skillDir)).toThrow(
        'Skill content escapes package root',
      )
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('rejects an escaping directory symlink', () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'intent-hash-outside-'))
    try {
      writeFileSync(join(outsideRoot, 'outside.md'), 'Outside\n')
      const skillDir = createSkill('escaping-directory', [
        ['SKILL.md', 'Root\n'],
      ])
      if (!tryCreateSymlink(outsideRoot, join(skillDir, 'outside'), 'dir')) {
        return
      }

      expect(() => hashSkill(skillDir)).toThrow(
        'Skill content escapes package root',
      )
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('rejects a dangling symlink without exposing its path', () => {
    const skillDir = createSkill('dangling', [['SKILL.md', 'Root\n']])
    if (
      !tryCreateSymlink(
        join(packageRoot, 'missing-target'),
        join(skillDir, 'dangling.md'),
        'file',
      )
    ) {
      return
    }

    let error: unknown
    try {
      hashSkill(skillDir)
    } catch (caught) {
      error = caught
    }
    expect(error).toEqual(new Error('Skill content is unreadable'))
    expect(String(error)).not.toContain(packageRoot)
  })

  it('rejects a directory symlink cycle', () => {
    const skillDir = createSkill('cycle', [['SKILL.md', 'Root\n']])
    if (!tryCreateSymlink(skillDir, join(skillDir, 'loop'), 'dir')) return

    expect(() => hashSkill(skillDir)).toThrow(
      'Skill content contains a directory cycle',
    )
  })

  it('supports symlinked package roots and skill directories', () => {
    const realPackageRoot = join(packageRoot, '.store', 'package')
    const realSkillDir = join(realPackageRoot, 'content', 'skill')
    mkdirSync(realSkillDir, { recursive: true })
    writeFileSync(join(realSkillDir, 'SKILL.md'), 'Root\n')

    const linkedPackageRoot = join(packageRoot, 'node_modules', 'package')
    mkdirSync(dirname(linkedPackageRoot), { recursive: true })
    if (!tryCreateSymlink(realPackageRoot, linkedPackageRoot, 'dir')) return

    const linkedSkillDir = join(realPackageRoot, 'skills', 'linked')
    mkdirSync(dirname(linkedSkillDir), { recursive: true })
    if (!tryCreateSymlink(realSkillDir, linkedSkillDir, 'dir')) return

    expect(
      computeSkillContentHash({
        packageRoot: linkedPackageRoot,
        skillDir: 'skills/linked',
      }),
    ).toMatch(/^sha256-[a-f0-9]{64}$/)
  })

  it('accepts an in-package root SKILL.md file symlink', () => {
    const target = join(packageRoot, 'targets', 'root-skill.md')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'Root\n')
    const skillDir = join(packageRoot, 'skills', 'linked-root-file')
    mkdirSync(skillDir, { recursive: true })
    if (!tryCreateSymlink(target, join(skillDir, 'SKILL.md'), 'file')) return

    expect(hashSkill(skillDir)).toMatch(/^sha256-[a-f0-9]{64}$/)
  })

  it('hashes the same directory target at distinct non-ancestor aliases', () => {
    const target = join(packageRoot, 'targets', 'shared-directory')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'shared.md'), 'Shared\n')
    const linked = createSkill('repeated-alias', [['SKILL.md', 'Root\n']])
    if (!tryCreateSymlink(target, join(linked, 'first'), 'dir')) return
    if (!tryCreateSymlink(target, join(linked, 'second'), 'dir')) return
    const copied = createSkill('repeated-copy', [
      ['SKILL.md', 'Root\n'],
      ['first/shared.md', 'Shared\n'],
      ['second/shared.md', 'Shared\n'],
    ])

    expect(hashSkill(linked)).toBe(hashSkill(copied))
  })

  it('rejects a validated file when open redirects outside the package', () => {
    const skillDir = createSkill('redirected-open', [
      ['SKILL.md', 'Root\n'],
      ['inside.md', 'Inside\n'],
    ])
    const validatedPath = realpathSync(join(skillDir, 'inside.md'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'intent-hash-outside-'))
    const outsidePath = join(outsideRoot, 'outside.md')
    writeFileSync(outsidePath, 'Outside\n')

    try {
      const redirectedFs: ReadFs = {
        ...nodeReadFs,
        openSync: ((...args: Array<unknown>) => {
          if (args[0] === validatedPath) args[0] = outsidePath
          return Reflect.apply(openSync, undefined, args)
        }) as NonNullable<ReadFs['openSync']>,
      }
      let acceptedHash: string | undefined

      expect(() => {
        acceptedHash = computeSkillContentHash({
          packageRoot,
          skillDir,
          fs: redirectedFs,
        })
      }).toThrow('Skill content changed during hashing')
      expect(acceptedHash).toBeUndefined()
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('uses only injected bounded filesystem reads', () => {
    const skillDir = createSkill('injected-fs', [
      ['SKILL.md', 'Root\n'],
      ['nested/large.bin', Buffer.alloc(70 * 1024, 0xff)],
    ])
    const calls = {
      opendir: 0,
      open: 0,
      read: 0,
      close: 0,
      fstat: 0,
      realpath: 0,
      lstat: 0,
    }
    let maxRequestedReadBytes = 0
    const injectedFs: ReadFs = {
      ...nodeReadFs,
      existsSync: () => {
        throw new Error('unexpected existsSync')
      },
      readFileSync: () => {
        throw new Error('unexpected readFileSync')
      },
      readdirSync: () => {
        throw new Error('unexpected readdirSync')
      },
      opendirSync: ((...args: Array<unknown>) => {
        calls.opendir += 1
        return Reflect.apply(opendirSync, undefined, args)
      }) as ReadFs['opendirSync'],
      openSync: ((...args: Array<unknown>) => {
        calls.open += 1
        return Reflect.apply(openSync, undefined, args)
      }) as NonNullable<ReadFs['openSync']>,
      readSync: ((...args: Array<unknown>) => {
        calls.read += 1
        if (typeof args[3] === 'number') {
          maxRequestedReadBytes = Math.max(maxRequestedReadBytes, args[3])
        }
        return Reflect.apply(readSync, undefined, args)
      }) as NonNullable<ReadFs['readSync']>,
      closeSync: ((...args: Array<unknown>) => {
        calls.close += 1
        return Reflect.apply(closeSync, undefined, args)
      }) as NonNullable<ReadFs['closeSync']>,
      fstatSync: ((...args: Array<unknown>) => {
        calls.fstat += 1
        return Reflect.apply(fstatSync, undefined, args)
      }) as NonNullable<ReadFs['fstatSync']>,
      realpathSync: ((...args: Array<unknown>) => {
        calls.realpath += 1
        return Reflect.apply(realpathSync, undefined, args)
      }) as ReadFs['realpathSync'],
      lstatSync: ((...args: Array<unknown>) => {
        calls.lstat += 1
        return Reflect.apply(lstatSync, undefined, args)
      }) as ReadFs['lstatSync'],
    }

    expect(
      computeSkillContentHash({ packageRoot, skillDir, fs: injectedFs }),
    ).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(calls.opendir).toBeGreaterThan(0)
    expect(calls.open).toBeGreaterThan(0)
    expect(calls.read).toBeGreaterThan(0)
    expect(calls.close).toBeGreaterThan(0)
    expect(calls.fstat).toBeGreaterThan(0)
    expect(calls.realpath).toBeGreaterThan(0)
    expect(calls.lstat).toBeGreaterThan(0)
    expect(maxRequestedReadBytes).toBeLessThanOrEqual(64 * 1024)
  })

  it('rejects a supplied reader missing any bounded filesystem method', () => {
    const skillDir = createSkill('missing-bounded-reads', [
      ['SKILL.md', 'Root\n'],
    ])
    const methods = [
      'opendirSync',
      'openSync',
      'readSync',
      'closeSync',
      'fstatSync',
    ] as const

    for (const method of methods) {
      const unboundedFs: ReadFs = { ...nodeReadFs, [method]: undefined }
      expect(() =>
        computeSkillContentHash({ packageRoot, skillDir, fs: unboundedFs }),
      ).toThrow('Skill hashing requires bounded filesystem reads')
    }
  })
})
