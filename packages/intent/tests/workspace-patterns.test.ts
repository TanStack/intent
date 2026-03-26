import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findPackagesWithSkills,
  findWorkspaceRoot,
  readWorkspacePatterns,
  resolveWorkspacePackages,
} from '../src/workspace-patterns.js'

const roots: Array<string> = []
const cwdStack: Array<string> = []

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workspace-patterns-test-')))
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

function writeDir(root: string, ...parts: Array<string>): void {
  mkdirSync(join(root, ...parts), { recursive: true })
}

afterEach(() => {
  if (cwdStack.length > 0) {
    process.chdir(cwdStack.pop()!)
  }

  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function withCwd(dir: string): void {
  cwdStack.push(process.cwd())
  process.chdir(dir)
}

describe('readWorkspacePatterns', () => {
  it('normalizes, drops empty patterns, dedupes, and sorts them', () => {
    const root = createRoot()

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        workspaces: [
          '',
          './apps/*/packages/*/',
          './packages/*/',
          'apps/*',
          'packages\\*',
          'apps/*',
        ],
      }),
    )

    expect(readWorkspacePatterns(root)).toEqual([
      'apps/*',
      'apps/*/packages/*',
      'packages/*',
    ])
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

  it('resolves nested workspace patterns segment by segment', () => {
    const root = createRoot()

    writePackage(root, 'apps', 'mobile', 'packages', 'native')
    writePackage(root, 'apps', 'web', 'packages', 'app')
    writePackage(root, 'apps', 'web', 'packages', 'ui')
    writeDir(root, 'apps', 'docs', 'packages', 'guides')

    expect(resolveWorkspacePackages(root, ['apps/*/packages/*'])).toEqual([
      join(root, 'apps', 'mobile', 'packages', 'native'),
      join(root, 'apps', 'web', 'packages', 'app'),
      join(root, 'apps', 'web', 'packages', 'ui'),
    ])
  })

  it('treats normalized nested patterns identically', () => {
    const root = createRoot()

    writePackage(root, 'apps', 'web', 'packages', 'app')

    expect(
      resolveWorkspacePackages(root, [
        './apps/*/packages/*/',
        'apps\\*\\packages\\*',
      ]),
    ).toEqual([join(root, 'apps', 'web', 'packages', 'app')])
  })

  it('supports recursive ** segments across multiple directory levels', () => {
    const root = createRoot()

    writePackage(root, 'apps', 'mobile', 'packages', 'native')
    writePackage(root, 'apps', 'web', 'features', 'packages', 'charts')
    writePackage(root, 'apps', 'web', 'packages', 'app')
    writeDir(root, 'apps', 'web', 'drafts', 'packages', 'notes')

    expect(resolveWorkspacePackages(root, ['apps/**/packages/*'])).toEqual([
      join(root, 'apps', 'mobile', 'packages', 'native'),
      join(root, 'apps', 'web', 'features', 'packages', 'charts'),
      join(root, 'apps', 'web', 'packages', 'app'),
    ])
  })

  it('ignores nonexistent literal segments and directories without package.json', () => {
    const root = createRoot()

    writePackage(root, 'apps', 'web', 'packages', 'app')
    writeDir(root, 'apps', 'web', 'packages', 'docs')

    expect(
      resolveWorkspacePackages(root, [
        '',
        'apps/admin/packages/*',
        'apps/web/packages/*',
      ]),
    ).toEqual([join(root, 'apps', 'web', 'packages', 'app')])
  })

  it('applies exclusion patterns from pnpm-workspace.yaml', () => {
    const root = createRoot()

    writePackage(root, 'packages', 'alpha')
    writePackage(root, 'packages', 'excluded')

    expect(
      resolveWorkspacePackages(root, ['packages/*', '!packages/excluded']),
    ).toEqual([join(root, 'packages', 'alpha')])
  })
})

describe('workspace helpers', () => {
  it('resolves pnpm workspace roots and returns only packages with skills', () => {
    const root = createRoot()

    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      ['packages:', '  - packages/*', "  - '!packages/excluded'"].join('\n'),
    )
    writePackage(root, 'packages', 'alpha')
    writePackage(root, 'packages', 'beta')
    writePackage(root, 'packages', 'excluded')
    writeDir(root, 'packages', 'alpha', 'skills', 'core', 'setup')
    writeDir(root, 'packages', 'excluded', 'skills', 'core', 'setup')
    writeFileSync(
      join(root, 'packages', 'alpha', 'skills', 'core', 'setup', 'SKILL.md'),
      '# alpha skill\n',
    )
    writeFileSync(
      join(root, 'packages', 'excluded', 'skills', 'core', 'setup', 'SKILL.md'),
      '# excluded skill\n',
    )

    const nestedDir = join(root, 'packages', 'alpha', 'src', 'nested')
    writeDir(root, 'packages', 'alpha', 'src', 'nested')
    withCwd(nestedDir)

    expect(findWorkspaceRoot(process.cwd())).toBe(root)
    expect(findPackagesWithSkills(root)).toEqual([
      join(root, 'packages', 'alpha'),
    ])
  })
})
