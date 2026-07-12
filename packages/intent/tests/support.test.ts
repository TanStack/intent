import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findMetaDir, getMetaDir } from '../src/commands/support.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'support-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function seedMeta(pkgDir: string): string {
  const metaDir = join(pkgDir, 'meta', 'templates', 'workflows')
  mkdirSync(metaDir, { recursive: true })
  writeFileSync(
    join(metaDir, 'check-skills.yml'),
    '# intent-workflow-version: 4\n',
  )
  return join(pkgDir, 'meta')
}

describe('findMetaDir', () => {
  it('resolves from the flat dist/ layout used by the published package', () => {
    const pkgDir = join(root, 'pkg')
    const metaDir = seedMeta(pkgDir)
    // Bundled module lives flat at <pkg>/dist/support-*.mjs.
    const startDir = join(pkgDir, 'dist')
    mkdirSync(startDir, { recursive: true })
    expect(findMetaDir(startDir)).toBe(metaDir)
  })

  it('resolves from the deep src/commands/ layout used in source', () => {
    const pkgDir = join(root, 'pkg')
    const metaDir = seedMeta(pkgDir)
    // Source module lives at <pkg>/src/commands/support.ts (two levels deep).
    const startDir = join(pkgDir, 'src', 'commands')
    mkdirSync(startDir, { recursive: true })
    expect(findMetaDir(startDir)).toBe(metaDir)
  })

  it('falls back to the historical ../../meta when no meta/ is found', () => {
    const startDir = join(root, 'pkg', 'dist')
    mkdirSync(startDir, { recursive: true })
    expect(findMetaDir(startDir)).toBe(join(startDir, '..', '..', 'meta'))
    expect(existsSync(findMetaDir(startDir))).toBe(false)
  })

  it('skips a stray file named meta and keeps walking', () => {
    const pkgDir = join(root, 'pkg')
    const metaDir = seedMeta(pkgDir)
    const startDir = join(pkgDir, 'dist')
    mkdirSync(startDir, { recursive: true })
    // A file (not a directory) named `meta` next to startDir must not short-circuit.
    writeFileSync(join(startDir, 'meta'), '')
    expect(findMetaDir(startDir)).toBe(metaDir)
  })

  it('resolves through a symlinked install path (pnpm-style)', () => {
    // Real package lives in a pnpm-style store; the consumer reaches it via a symlink.
    const storePkg = join(
      root,
      'store',
      '@tanstack+intent',
      'node_modules',
      '@tanstack',
      'intent',
    )
    seedMeta(storePkg)
    mkdirSync(join(storePkg, 'dist'), { recursive: true })

    const consumerTanstack = join(root, 'consumer', 'node_modules', '@tanstack')
    mkdirSync(consumerTanstack, { recursive: true })
    symlinkSync(storePkg, join(consumerTanstack, 'intent'), 'dir')

    const startDir = join(consumerTanstack, 'intent', 'dist')
    const resolved = findMetaDir(startDir)
    expect(resolved).toBe(join(consumerTanstack, 'intent', 'meta'))
    expect(existsSync(resolved)).toBe(true)
  })
})

describe('getMetaDir', () => {
  it('resolves to a meta/ directory that ships the workflow template', () => {
    const metaDir = getMetaDir()
    expect(existsSync(metaDir)).toBe(true)
    expect(
      existsSync(join(metaDir, 'templates', 'workflows', 'check-skills.yml')),
    ).toBe(true)
  })
})
