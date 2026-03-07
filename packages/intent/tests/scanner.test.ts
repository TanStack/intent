import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForIntents } from '../src/scanner.js'

// ── Helpers ──

function createDir(...segments: string[]): string {
  const dir = join(...segments)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeSkillMd(dir: string, frontmatter: Record<string, unknown>): void {
  const yamlLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`)
    .join('\n')
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\n${yamlLines}\n---\n\nSkill content here.\n`,
  )
}

// ── Setup / Teardown ──

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'intent-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// ── Tests ──

describe('scanForIntents', () => {
  it('returns empty packages when no node_modules exists', () => {
    const result = scanForIntents(root)
    expect(result.packages).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('returns empty packages when node_modules has no intent packages', () => {
    createDir(root, 'node_modules', 'some-lib')
    writeJson(join(root, 'node_modules', 'some-lib', 'package.json'), {
      name: 'some-lib',
      version: '1.0.0',
    })
    const result = scanForIntents(root)
    expect(result.packages).toEqual([])
  })

  it('discovers an intent-enabled package with skills', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'db')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: {
        version: 1,
        repo: 'TanStack/db',
        docs: 'docs/',
      },
    })
    const skillDir = createDir(pkgDir, 'skills', 'db-core')
    writeSkillMd(skillDir, {
      name: 'db-core',
      description: 'Core database concepts',
      type: 'core',
    })

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[0]!.version).toBe('0.5.2')
    expect(result.packages[0]!.skills).toHaveLength(1)
    expect(result.packages[0]!.skills[0]!.name).toBe('db-core')
    expect(result.packages[0]!.skills[0]!.description).toBe(
      'Core database concepts',
    )
  })

  it('discovers packages through symlinks (pnpm layout)', () => {
    // pnpm stores packages outside node_modules and symlinks them in
    const store = createDir(root, '.pnpm-store', '@tanstack', 'db')
    writeJson(join(store, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    const skillDir = createDir(store, 'skills', 'db-core')
    writeSkillMd(skillDir, {
      name: 'db-core',
      description: 'Core database concepts',
      type: 'core',
    })

    // Create the scoped dir, then symlink the package (like pnpm does)
    createDir(root, 'node_modules', '@tanstack')
    symlinkSync(store, join(root, 'node_modules', '@tanstack', 'db'))

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[0]!.skills).toHaveLength(1)
  })

  it('discovers unscoped packages through symlinks (pnpm layout)', () => {
    const store = createDir(root, '.pnpm-store', 'my-lib')
    writeJson(join(store, 'package.json'), {
      name: 'my-lib',
      version: '1.0.0',
      intent: { version: 1, repo: 'foo/my-lib', docs: 'docs/' },
    })
    const skillDir = createDir(store, 'skills', 'my-skill')
    writeSkillMd(skillDir, { name: 'my-skill', description: 'A skill' })

    createDir(root, 'node_modules')
    symlinkSync(store, join(root, 'node_modules', 'my-lib'))

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('my-lib')
  })

  it('discovers sub-skills', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'db')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    const coreDir = createDir(pkgDir, 'skills', 'db-core')
    writeSkillMd(coreDir, { name: 'db-core', description: 'Core' })
    const subDir = createDir(coreDir, 'live-queries')
    writeSkillMd(subDir, {
      name: 'db-core/live-queries',
      description: 'Queries',
    })

    const result = scanForIntents(root)
    expect(result.packages[0]!.skills).toHaveLength(2)
    const names = result.packages[0]!.skills.map((s) => s.name)
    expect(names).toContain('db-core')
    expect(names).toContain('db-core/live-queries')
  })

  it('warns on skills/ dir without valid intent field', () => {
    const pkgDir = createDir(root, 'node_modules', 'bad-pkg')
    writeJson(join(pkgDir, 'package.json'), {
      name: 'bad-pkg',
      version: '1.0.0',
      // no intent field
    })
    createDir(pkgDir, 'skills', 'some-skill')

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('bad-pkg')
  })

  it('warns on invalid intent version', () => {
    const pkgDir = createDir(root, 'node_modules', 'wrong-ver')
    writeJson(join(pkgDir, 'package.json'), {
      name: 'wrong-ver',
      version: '1.0.0',
      intent: { version: 99, repo: 'foo/bar', docs: 'docs/' },
    })
    createDir(pkgDir, 'skills', 'some-skill')

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
  })

  it('sorts packages by dependency order (requires)', () => {
    // Create core package (no requires)
    const coreDir = createDir(root, 'node_modules', '@tanstack', 'db')
    writeJson(join(coreDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.0',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    const coreSkill = createDir(coreDir, 'skills', 'db-core')
    writeSkillMd(coreSkill, { name: 'db-core', description: 'Core' })

    // Create framework package (requires core)
    const reactDir = createDir(root, 'node_modules', '@tanstack', 'react-db')
    writeJson(join(reactDir, 'package.json'), {
      name: '@tanstack/react-db',
      version: '0.5.0',
      intent: {
        version: 1,
        repo: 'TanStack/db',
        docs: 'docs/',
        requires: ['@tanstack/db'],
      },
    })
    const reactSkill = createDir(reactDir, 'skills', 'react-db')
    writeSkillMd(reactSkill, {
      name: 'react-db',
      description: 'React bindings',
    })

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(2)
    // Core should come first
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[1]!.name).toBe('@tanstack/react-db')
  })

  it('skips packages without skills/ directory', () => {
    const pkgDir = createDir(root, 'node_modules', 'no-skills')
    writeJson(join(pkgDir, 'package.json'), {
      name: 'no-skills',
      version: '1.0.0',
      intent: { version: 1, repo: 'foo/bar', docs: 'docs/' },
    })
    // No skills/ directory

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('package manager detection', () => {
  it('detects npm from package-lock.json', () => {
    writeFileSync(join(root, 'package-lock.json'), '{}')
    createDir(root, 'node_modules')
    const result = scanForIntents(root)
    expect(result.packageManager).toBe('npm')
  })

  it('detects pnpm from pnpm-lock.yaml', () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    createDir(root, 'node_modules')
    const result = scanForIntents(root)
    expect(result.packageManager).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', () => {
    writeFileSync(join(root, 'yarn.lock'), '')
    createDir(root, 'node_modules')
    const result = scanForIntents(root)
    expect(result.packageManager).toBe('yarn')
  })

  it('detects bun from bun.lockb', () => {
    writeFileSync(join(root, 'bun.lockb'), '')
    createDir(root, 'node_modules')
    const result = scanForIntents(root)
    expect(result.packageManager).toBe('bun')
  })

  it('returns unknown when no lockfile found', () => {
    createDir(root, 'node_modules')
    const result = scanForIntents(root)
    expect(result.packageManager).toBe('unknown')
  })

  it('throws for Yarn PnP', () => {
    writeFileSync(join(root, '.pnp.cjs'), '')
    expect(() => scanForIntents(root)).toThrow('Yarn PnP')
  })

  it('throws for Deno without node_modules', () => {
    writeFileSync(join(root, 'deno.json'), '{}')
    expect(() => scanForIntents(root)).toThrow(
      'Deno without node_modules',
    )
  })
})
