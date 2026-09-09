import { delimiter, join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectGlobalNodeModules,
  parsePnpmGlobalLsRoots,
  splitGlobalNodeModulesEnvPaths,
} from '../src/shared/utils.js'

// ── Helpers ──

const globalBase = join(sep, 'Users', 'me', 'Library', 'pnpm', 'global')

function pnpmLsJson(
  dependencies: Record<string, { version: string; path: string }>,
): string {
  return JSON.stringify([{ path: join(globalBase, 'v11'), dependencies }])
}

// ── Setup / Teardown ──

let previousGlobalNodeModules: string | undefined

beforeEach(() => {
  previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES
  delete process.env.INTENT_GLOBAL_NODE_MODULES
})

afterEach(() => {
  if (previousGlobalNodeModules === undefined) {
    delete process.env.INTENT_GLOBAL_NODE_MODULES
  } else {
    process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
  }
})

// ── parsePnpmGlobalLsRoots ──

describe('parsePnpmGlobalLsRoots', () => {
  it('derives one root per isolated global package dir (pnpm 11 layout)', () => {
    const rootA = join(globalBase, 'v11', 'd74d-aaa', 'node_modules')
    const rootB = join(globalBase, 'v11', 'd74d-bbb', 'node_modules')
    const output = pnpmLsJson({
      '@tanstack/cli': {
        version: '0.70.0',
        path: join(rootA, '@tanstack', 'cli'),
      },
      'playwright-cli': {
        version: '1.0.0',
        path: join(rootB, 'playwright-cli'),
      },
    })

    expect(parsePnpmGlobalLsRoots(output)).toEqual([rootA, rootB])
  })

  it('collapses to a single root when all packages share one node_modules (pnpm 10 layout)', () => {
    const root = join(globalBase, '5', 'node_modules')
    const output = pnpmLsJson({
      '@tanstack/cli': {
        version: '0.70.0',
        path: join(root, '@tanstack', 'cli'),
      },
      'playwright-cli': {
        version: '1.0.0',
        path: join(root, 'playwright-cli'),
      },
    })

    expect(parsePnpmGlobalLsRoots(output)).toEqual([root])
  })

  it('ignores dependencies without a usable path', () => {
    const root = join(globalBase, 'v11', 'd74d-aaa', 'node_modules')
    const output = JSON.stringify([
      {
        path: join(globalBase, 'v11'),
        dependencies: {
          '@tanstack/cli': {
            version: '0.70.0',
            path: join(root, '@tanstack', 'cli'),
          },
          'no-path': { version: '1.0.0' },
          'outside-node-modules': {
            version: '1.0.0',
            path: join(globalBase, 'v11', 'plain-dir'),
          },
        },
      },
      { path: join(globalBase, 'v11') },
    ])

    expect(parsePnpmGlobalLsRoots(output)).toEqual([root])
  })

  it('does not match directories that merely start with node_modules', () => {
    const output = pnpmLsJson({
      'some-cli': {
        version: '1.0.0',
        path: join(globalBase, 'v11', 'node_modules_backup', 'some-cli'),
      },
    })

    expect(parsePnpmGlobalLsRoots(output)).toEqual([])
  })

  it('returns no roots for malformed or non-array output', () => {
    expect(parsePnpmGlobalLsRoots('not json')).toEqual([])
    expect(parsePnpmGlobalLsRoots('{"path": "/tmp"}')).toEqual([])
    expect(parsePnpmGlobalLsRoots('[null, 42]')).toEqual([])
  })
})

// ── splitGlobalNodeModulesEnvPaths ──

describe('splitGlobalNodeModulesEnvPaths', () => {
  it('returns no paths when the override is unset or blank', () => {
    expect(splitGlobalNodeModulesEnvPaths(undefined)).toEqual([])
    expect(splitGlobalNodeModulesEnvPaths('')).toEqual([])
    expect(splitGlobalNodeModulesEnvPaths('   ')).toEqual([])
  })

  it('returns a single trimmed path', () => {
    const root = join(globalBase, '5', 'node_modules')
    expect(splitGlobalNodeModulesEnvPaths(` ${root} `)).toEqual([root])
  })

  it('splits a path.delimiter-separated list and drops empty entries', () => {
    const rootA = join(globalBase, 'v11', 'd74d-aaa', 'node_modules')
    const rootB = join(globalBase, 'v11', 'd74d-bbb', 'node_modules')
    const value = `${rootA}${delimiter}${delimiter} ${rootB} ${delimiter}`

    expect(splitGlobalNodeModulesEnvPaths(value)).toEqual([rootA, rootB])
  })
})

// ── detectGlobalNodeModules ──

describe('detectGlobalNodeModules', () => {
  it('prefers the INTENT_GLOBAL_NODE_MODULES override, including path lists', () => {
    const rootA = join(globalBase, 'v11', 'd74d-aaa', 'node_modules')
    const rootB = join(globalBase, 'v11', 'd74d-bbb', 'node_modules')
    process.env.INTENT_GLOBAL_NODE_MODULES = `${rootA}${delimiter}${rootB}`

    expect(detectGlobalNodeModules('pnpm')).toEqual({
      paths: [rootA, rootB],
      source: 'INTENT_GLOBAL_NODE_MODULES',
    })
  })
})
