import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveDepDir } from '../src/shared/utils.js'

let root: string

function createPackage(...segments: Array<string>): string {
  const dir = join(...segments)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{}')
  return dir
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-resolve-dep-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveDepDir', () => {
  it('resolves a dependency nested under the parent package', () => {
    const parent = createPackage(root, 'node_modules', 'parent')
    const nested = createPackage(parent, 'node_modules', 'dep')
    createPackage(root, 'node_modules', 'dep')

    expect(resolveDepDir('dep', parent)).toBe(nested)
  })

  it('walks up to a hoisted dependency, including scoped names', () => {
    const parent = createPackage(root, 'node_modules', 'parent')
    const hoisted = createPackage(root, 'node_modules', '@scope', 'dep')

    expect(resolveDepDir('@scope/dep', parent)).toBe(hoisted)
  })

  it('finds a virtual-store sibling without probing node_modules/node_modules', () => {
    // pnpm layout: `.pnpm/parent@1/node_modules/parent` depends on a sibling
    // `.pnpm/parent@1/node_modules/dep`; Node never looks inside
    // `.pnpm/parent@1/node_modules/node_modules`.
    const store = join(root, 'node_modules', '.pnpm', 'parent@1.0.0')
    const parent = createPackage(store, 'node_modules', 'parent')
    const sibling = createPackage(store, 'node_modules', 'dep')
    createPackage(store, 'node_modules', 'node_modules', 'dep')

    expect(resolveDepDir('dep', parent)).toBe(sibling)
  })

  it('collapses a symlinked match to its real directory', () => {
    const real = createPackage(root, 'store', 'dep')
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(real, join(root, 'node_modules', 'dep'), 'junction')
    const parent = createPackage(root, 'node_modules', 'parent')

    expect(resolveDepDir('dep', parent)).toBe(real)
  })

  it('ignores a directory without package.json and returns null when nothing matches', () => {
    const parent = createPackage(root, 'node_modules', 'parent')
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })

    expect(resolveDepDir('dep', parent)).toBeNull()
    expect(resolveDepDir('missing', parent)).toBeNull()
  })
})
