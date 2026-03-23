import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeWorkspacePatterns,
  resolveWorkspacePackages,
} from '../src/workspace-patterns.js'

const roots: Array<string> = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'workspace-patterns-test-'))
  roots.push(root)
  return root
}

function writePackage(root: string, ...parts: Array<string>): void {
  const dir = join(root, ...parts)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: parts.join('/') }),
  )
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('normalizeWorkspacePatterns', () => {
  it('normalizes, drops empty patterns, dedupes, and sorts them', () => {
    expect(
      normalizeWorkspacePatterns([
        '',
        './apps/*/packages/*/',
        './packages/*/',
        'apps/*',
        'packages\\*',
        'apps/*',
      ]),
    ).toEqual(['apps/*', 'apps/*/packages/*', 'packages/*'])
  })
})

describe('resolveWorkspacePackages', () => {
  it('dedupes and sorts resolved package roots for simple patterns', () => {
    const root = createRoot()

    writePackage(root, 'packages', 'b-lib')
    writePackage(root, 'packages', 'a-lib')

    expect(
      resolveWorkspacePackages(root, [
        './packages/*/',
        'packages\\*',
        'packages/*',
      ]),
    ).toEqual([
      join(root, 'packages', 'a-lib'),
      join(root, 'packages', 'b-lib'),
    ])
  })
})
