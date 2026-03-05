import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runAddLibraryBin,
  runEditPackageJson,
  runSetupGithubActions,
} from '../src/setup.js'

let root: string
let metaDir: string

function writePkg(data: Record<string, unknown>, indent?: number): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify(data, null, indent))
}

function readPkg(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'setup-test-'))
  metaDir = join(root, 'meta')

  // Create mock templates
  mkdirSync(join(metaDir, 'templates', 'workflows'), { recursive: true })

  writeFileSync(
    join(metaDir, 'templates', 'workflows', 'notify-intent.yml'),
    'package: {{PACKAGE_NAME}}\nrepo: {{REPO}}\ndocs: {{DOCS_PATH}}\nsrc: {{SRC_PATH}}',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('runAddLibraryBin', () => {
  it('generates bin/intent.js for type:module packages', () => {
    writePkg({ name: 'test-pkg', type: 'module' })

    const result = runAddLibraryBin(root)
    expect(result.shim).toBe(join(root, 'bin', 'intent.js'))
    expect(result.skipped).toBeNull()
    expect(existsSync(join(root, 'bin', 'intent.js'))).toBe(true)
  })

  it('generates bin/intent.mjs for non-module packages', () => {
    writePkg({ name: 'test-pkg' })

    const result = runAddLibraryBin(root)
    expect(result.shim).toBe(join(root, 'bin', 'intent.mjs'))
    expect(existsSync(join(root, 'bin', 'intent.mjs'))).toBe(true)
  })

  it('skips if bin/intent.js already exists', () => {
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin', 'intent.js'), 'existing')

    const result = runAddLibraryBin(root)
    expect(result.shim).toBeNull()
    expect(result.skipped).toBe(join(root, 'bin', 'intent.js'))
    expect(readFileSync(join(root, 'bin', 'intent.js'), 'utf8')).toBe(
      'existing',
    )
  })

  it('skips if bin/intent.mjs already exists', () => {
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin', 'intent.mjs'), 'existing')

    const result = runAddLibraryBin(root)
    expect(result.shim).toBeNull()
    expect(result.skipped).toBe(join(root, 'bin', 'intent.mjs'))
  })

  it('generates shim with correct content', () => {
    writePkg({ name: 'test-pkg', type: 'module' })

    runAddLibraryBin(root)

    const content = readFileSync(join(root, 'bin', 'intent.js'), 'utf8')
    expect(content).toContain('#!/usr/bin/env node')
    expect(content).toContain('@tanstack/intent/intent-library')
  })
})

describe('runEditPackageJson', () => {
  it('adds skills, bin, and !skills/_artifacts to files array', () => {
    writePkg({ name: 'test-pkg', files: ['dist', 'src'] }, 2)

    const result = runEditPackageJson(root)
    expect(result.added).toContain('files: "skills"')
    expect(result.added).toContain('files: "bin"')
    expect(result.added).toContain('files: "!skills/_artifacts"')

    const pkg = readPkg()
    expect(pkg.files).toContain('skills')
    expect(pkg.files).toContain('bin')
    expect(pkg.files).toContain('!skills/_artifacts')
    expect(pkg.files).toContain('dist')
    expect(pkg.files).toContain('src')
  })

  it('adds bin field when missing', () => {
    writePkg({ name: 'test-pkg', files: [] }, 2)

    const result = runEditPackageJson(root)
    expect(result.added).toEqual(
      expect.arrayContaining([expect.stringMatching(/^bin\.intent/)]),
    )

    const pkg = readPkg()
    expect(pkg.bin.intent).toMatch(/\.\/bin\/intent\.(js|mjs)/)
  })

  it('is idempotent — re-running does not duplicate entries', () => {
    writePkg({ name: 'test-pkg', files: ['dist'] }, 2)

    runEditPackageJson(root)
    const result = runEditPackageJson(root)

    expect(result.added).toHaveLength(0)
    expect(result.alreadyPresent.length).toBeGreaterThan(0)

    const pkg = readPkg()
    const skillsCount = pkg.files.filter((f: string) => f === 'skills').length
    expect(skillsCount).toBe(1)
  })

  it('preserves existing package.json content', () => {
    writePkg(
      {
        name: 'test-pkg',
        version: '1.0.0',
        description: 'A test package',
        files: ['dist'],
      },
      2,
    )

    runEditPackageJson(root)

    const pkg = readPkg()
    expect(pkg.name).toBe('test-pkg')
    expect(pkg.version).toBe('1.0.0')
    expect(pkg.description).toBe('A test package')
    expect(pkg.files).toContain('dist')
  })

  it('preserves existing bin entries when adding intent', () => {
    writePkg(
      { name: 'test-pkg', files: [], bin: { 'my-cli': './bin/cli.js' } },
      2,
    )

    runEditPackageJson(root)

    const pkg = readPkg() as Record<string, unknown>
    const bin = pkg.bin as Record<string, string>
    expect(bin['my-cli']).toBe('./bin/cli.js')
    expect(bin.intent).toMatch(/\.\/bin\/intent\.(js|mjs)/)
  })

  it('converts string bin to object preserving existing entry', () => {
    writePkg({ name: '@scope/my-tool', files: [], bin: './dist/cli.js' }, 2)

    const result = runEditPackageJson(root)

    const pkg = readPkg() as Record<string, unknown>
    const bin = pkg.bin as Record<string, string>
    expect(bin['my-tool']).toBe('./dist/cli.js')
    expect(bin.intent).toMatch(/\.\/bin\/intent\.(js|mjs)/)
    expect(result.added).toEqual(
      expect.arrayContaining([
        expect.stringContaining('converted bin from string'),
      ]),
    )
  })

  it('creates files array if missing', () => {
    writePkg({ name: 'test-pkg' }, 2)

    runEditPackageJson(root)

    const pkg = readPkg()
    expect(pkg.files).toContain('skills')
    expect(pkg.files).toContain('bin')
    expect(pkg.files).toContain('!skills/_artifacts')
  })

  it('returns empty result when no package.json exists', () => {
    const result = runEditPackageJson(root)
    expect(result.added).toHaveLength(0)
    expect(result.alreadyPresent).toHaveLength(0)
  })

  it('preserves 4-space indentation', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'test-pkg', files: ['dist'] }, null, 4),
    )

    runEditPackageJson(root)

    const raw = readFileSync(join(root, 'package.json'), 'utf8')
    expect(raw).toContain('    "name"')
    expect(raw).not.toMatch(/^ {2}"name"/m)
  })
})

describe('runSetupGithubActions', () => {
  it('copies workflow templates with variable substitution', () => {
    writePkg({
      name: '@tanstack/query',
      intent: { repo: 'TanStack/query', docs: 'docs/' },
    })

    const result = runSetupGithubActions(root, metaDir)
    expect(result.workflows).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)

    const wfContent = readFileSync(
      join(root, '.github', 'workflows', 'notify-intent.yml'),
      'utf8',
    )
    expect(wfContent).toContain('package: @tanstack/query')
    expect(wfContent).toContain('repo: TanStack/query')
    expect(wfContent).toContain('docs: docs/**')
  })

  it('copies templates with defaults when no package.json', () => {
    const result = runSetupGithubActions(root, metaDir)
    expect(result.workflows).toHaveLength(1)

    const wfPath = join(root, '.github', 'workflows', 'notify-intent.yml')
    expect(existsSync(wfPath)).toBe(true)
    const content = readFileSync(wfPath, 'utf8')
    expect(content).toContain('package: unknown')
  })

  it('skips existing workflow files', () => {
    runSetupGithubActions(root, metaDir)
    const result = runSetupGithubActions(root, metaDir)
    expect(result.workflows).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
  })

  it('handles missing templates directory gracefully', () => {
    const emptyMeta = join(root, 'empty-meta')
    mkdirSync(emptyMeta)
    const result = runSetupGithubActions(root, emptyMeta)
    expect(result.workflows).toHaveLength(0)
  })
})
