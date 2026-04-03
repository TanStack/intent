import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForIntents } from '../src/scanner.js'

// ── Helpers ──

function createDir(...segments: Array<string>): string {
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
let globalRoot: string
let previousGlobalNodeModules: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-test-')))
  globalRoot = realpathSync(mkdtempSync(join(tmpdir(), 'intent-global-test-')))
  previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES
  delete process.env.INTENT_GLOBAL_NODE_MODULES
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(globalRoot, { recursive: true, force: true })
  if (previousGlobalNodeModules === undefined) {
    delete process.env.INTENT_GLOBAL_NODE_MODULES
  } else {
    process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
  }
})

// ── Tests ──

describe('scanForIntents', () => {
  it('returns empty packages when no node_modules exists', () => {
    const result = scanForIntents(root)
    expect(result.packages).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.nodeModules.local.exists).toBe(false)
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

  it('handles empty package name without producing double-slash paths', () => {
    const pkgDir = createDir(root, 'node_modules', 'no-name-pkg')
    writeJson(join(pkgDir, 'package.json'), {
      name: '',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    const skillDir = createDir(pkgDir, 'skills', 'core')
    writeSkillMd(skillDir, { name: 'core', description: 'Core skill' })

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.skills[0]!.path).not.toContain('//')
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
    expect(result.packages[0]!.packageRoot).toBe(pkgDir)
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

  it('discovers skills nested under intermediate dirs without SKILL.md', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'db')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    // intermediate directory has no SKILL.md
    const groupDir = createDir(pkgDir, 'skills', 'group')
    const nestedDir = createDir(groupDir, 'nested-skill')
    writeSkillMd(nestedDir, {
      name: 'group/nested-skill',
      description: 'A nested skill under a grouping dir',
    })

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.skills).toHaveLength(1)
    expect(result.packages[0]!.skills[0]!.name).toBe('group/nested-skill')
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

  it('discovers global-only intent packages', () => {
    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot

    const pkgDir = createDir(globalRoot, '@tanstack', 'query')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(pkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    const result = scanForIntents(root)

    expect(result.nodeModules.global.detected).toBe(true)
    expect(result.nodeModules.global.exists).toBe(true)
    expect(result.nodeModules.global.scanned).toBe(true)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/query')
  })

  it('prefers local packages over global packages with the same name', () => {
    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot

    const localPkgDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(localPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.1.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(localPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Local fetching skill',
    })

    const globalPkgDir = createDir(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    const result = scanForIntents(root)

    expect(result.nodeModules.global.detected).toBe(true)
    expect(result.nodeModules.global.scanned).toBe(true)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.version).toBe('5.1.0')
    expect(result.packages[0]!.skills[0]!.description).toBe(
      'Local fetching skill',
    )
    expect(
      result.warnings.some(
        (warning) =>
          warning.includes('Found 2 installed variants of @tanstack/query') &&
          warning.includes('Using 5.1.0'),
      ),
    ).toBe(true)
  })

  it('ignores global packages by default even when configured', () => {
    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot

    const pkgDir = createDir(globalRoot, '@tanstack', 'query')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(pkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    const result = scanForIntents(root, { includeGlobal: true })

    expect(result.nodeModules.global.detected).toBe(true)
    expect(result.nodeModules.global.scanned).toBe(false)
    expect(result.packages).toEqual([])
  })

  it('chooses the highest version when duplicate package names exist at the same depth', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: {
        'consumer-a': '1.0.0',
        'consumer-b': '1.0.0',
        'consumer-c': '1.0.0',
      },
    })

    const consumerADir = createDir(root, 'node_modules', 'consumer-a')
    writeJson(join(consumerADir, 'package.json'), {
      name: 'consumer-a',
      version: '1.0.0',
      dependencies: {
        '@tanstack/query': '4.0.0',
      },
    })

    const consumerBDir = createDir(root, 'node_modules', 'consumer-b')
    writeJson(join(consumerBDir, 'package.json'), {
      name: 'consumer-b',
      version: '1.0.0',
      dependencies: {
        '@tanstack/query': '5.0.0',
      },
    })

    const consumerCDir = createDir(root, 'node_modules', 'consumer-c')
    writeJson(join(consumerCDir, 'package.json'), {
      name: 'consumer-c',
      version: '1.0.0',
      dependencies: {
        '@tanstack/query': '3.0.0',
      },
    })

    const queryV4Dir = createDir(
      consumerADir,
      'node_modules',
      '@tanstack',
      'query',
    )
    writeJson(join(queryV4Dir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(queryV4Dir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query v4 skill',
    })

    const queryV5Dir = createDir(
      consumerBDir,
      'node_modules',
      '@tanstack',
      'query',
    )
    writeJson(join(queryV5Dir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(queryV5Dir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query v5 skill',
    })

    const queryV3Dir = createDir(
      consumerCDir,
      'node_modules',
      '@tanstack',
      'query',
    )
    writeJson(join(queryV3Dir, 'package.json'), {
      name: '@tanstack/query',
      version: '3.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(queryV3Dir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query v3 skill',
    })

    const result = scanForIntents(root, { includeGlobal: true })
    const versionWarning = result.warnings.find((warning) =>
      warning.includes('@tanstack/query'),
    )

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/query')
    expect(result.packages[0]!.version).toBe('5.0.0')
    expect(result.packages[0]!.packageRoot).toBe(queryV5Dir)
    expect(versionWarning).toContain(
      'Found 3 installed variants of @tanstack/query',
    )
    expect(versionWarning).toContain('across 3 versions')
    expect(versionWarning).toContain('Using 5.0.0')
  })

  it('prefers stable releases over prereleases at the same depth', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: {
        'consumer-a': '1.0.0',
        'consumer-b': '1.0.0',
      },
    })

    const consumerADir = createDir(root, 'node_modules', 'consumer-a')
    const consumerBDir = createDir(root, 'node_modules', 'consumer-b')

    writeJson(join(consumerADir, 'package.json'), {
      name: 'consumer-a',
      version: '1.0.0',
      dependencies: { '@tanstack/query': '5.0.0-beta.1' },
    })
    writeJson(join(consumerBDir, 'package.json'), {
      name: 'consumer-b',
      version: '1.0.0',
      dependencies: { '@tanstack/query': '5.0.0' },
    })

    const prereleaseDir = createDir(
      consumerADir,
      'node_modules',
      '@tanstack',
      'query',
    )
    const stableDir = createDir(
      consumerBDir,
      'node_modules',
      '@tanstack',
      'query',
    )

    writeJson(join(prereleaseDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0-beta.1',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeJson(join(stableDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(prereleaseDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Prerelease query skill',
    })
    writeSkillMd(createDir(stableDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Stable query skill',
    })

    const result = scanForIntents(root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.version).toBe('5.0.0')
    expect(result.packages[0]!.packageRoot).toBe(stableDir)
  })

  it('finds hoisted deps when scanning from a workspace package subdir', () => {
    // Simulate npm/yarn/bun monorepo: deps hoisted to root node_modules
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
      workspaces: ['packages/*'],
    })

    const appDir = join(root, 'packages', 'app')
    createDir(root, 'packages', 'app')
    writeJson(join(appDir, 'package.json'), {
      name: '@monorepo/app',
      version: '1.0.0',
      dependencies: { '@tanstack/db': '0.5.0' },
    })

    // Dep is hoisted to root, NOT in app's node_modules
    createDir(root, 'node_modules', '@tanstack', 'db')
    createDir(root, 'node_modules', '@tanstack', 'db', 'skills', 'db-core')
    const dbDir = join(root, 'node_modules', '@tanstack', 'db')
    writeJson(join(dbDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.0',
      intent: {
        version: 1,
        repo: 'TanStack/db',
        docs: 'https://db.tanstack.com',
      },
    })
    writeSkillMd(join(dbDir, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    // Scan from the workspace package subdir (not root)
    const result = scanForIntents(appDir)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
  })

  it('discovers skills in workspace package dependencies from monorepo root', () => {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
    })

    const appDir = join(root, 'packages', 'app')
    createDir(root, 'packages', 'app')
    writeJson(join(appDir, 'package.json'), {
      name: '@monorepo/app',
      version: '1.0.0',
      dependencies: { '@tanstack/db': '0.5.0' },
    })

    createDir(appDir, 'node_modules', '@tanstack', 'db')
    createDir(appDir, 'node_modules', '@tanstack', 'db', 'skills', 'db-core')
    const dbDir = join(appDir, 'node_modules', '@tanstack', 'db')
    writeJson(join(dbDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.0',
      intent: {
        version: 1,
        repo: 'TanStack/db',
        docs: 'https://db.tanstack.com',
      },
    })
    writeSkillMd(join(dbDir, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    createDir(root, 'node_modules')

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[0]!.skills).toHaveLength(1)
  })

  it('discovers transitive skills through workspace package deps', () => {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
    })

    const appDir = join(root, 'packages', 'app')
    createDir(root, 'packages', 'app')
    writeJson(join(appDir, 'package.json'), {
      name: '@monorepo/app',
      version: '1.0.0',
      dependencies: { wrapper: '1.0.0' },
    })

    // wrapper has no skills, but depends on skills-pkg
    createDir(appDir, 'node_modules', 'wrapper')
    writeJson(join(appDir, 'node_modules', 'wrapper', 'package.json'), {
      name: 'wrapper',
      version: '1.0.0',
      dependencies: { 'skills-pkg': '1.0.0' },
    })

    // skills-pkg is a transitive dep (sibling in node_modules)
    createDir(appDir, 'node_modules', 'skills-pkg')
    createDir(appDir, 'node_modules', 'skills-pkg', 'skills', 'core')
    writeJson(join(appDir, 'node_modules', 'skills-pkg', 'package.json'), {
      name: 'skills-pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/skills', docs: 'https://example.com' },
    })
    writeSkillMd(join(appDir, 'node_modules', 'skills-pkg', 'skills', 'core'), {
      name: 'core',
      description: 'Core skill',
    })

    createDir(root, 'node_modules')

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('skills-pkg')
  })

  it('discovers skills using package.json workspaces', () => {
    writeJson(join(root, 'package.json'), {
      name: 'monorepo',
      private: true,
      workspaces: ['packages/*'],
    })

    const appDir = join(root, 'packages', 'app')
    createDir(root, 'packages', 'app')
    writeJson(join(appDir, 'package.json'), {
      name: '@monorepo/app',
      version: '1.0.0',
      dependencies: { '@tanstack/db': '0.5.0' },
    })

    createDir(root, 'node_modules', '@tanstack', 'db')
    createDir(root, 'node_modules', '@tanstack', 'db', 'skills', 'db-core')
    const dbDir = join(root, 'node_modules', '@tanstack', 'db')
    writeJson(join(dbDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.0',
      intent: {
        version: 1,
        repo: 'TanStack/db',
        docs: 'https://db.tanstack.com',
      },
    })
    writeSkillMd(join(dbDir, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    const result = scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
  })

  it('prefers valid semver versions over invalid ones at the same depth', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: {
        'consumer-a': '1.0.0',
        'consumer-b': '1.0.0',
      },
    })

    const consumerADir = createDir(root, 'node_modules', 'consumer-a')
    const consumerBDir = createDir(root, 'node_modules', 'consumer-b')

    writeJson(join(consumerADir, 'package.json'), {
      name: 'consumer-a',
      version: '1.0.0',
      dependencies: { '@tanstack/query': 'workspace-dev' },
    })
    writeJson(join(consumerBDir, 'package.json'), {
      name: 'consumer-b',
      version: '1.0.0',
      dependencies: { '@tanstack/query': '5.0.0' },
    })

    const invalidDir = createDir(
      consumerADir,
      'node_modules',
      '@tanstack',
      'query',
    )
    const validDir = createDir(
      consumerBDir,
      'node_modules',
      '@tanstack',
      'query',
    )

    writeJson(join(invalidDir, 'package.json'), {
      name: '@tanstack/query',
      version: 'workspace-dev',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeJson(join(validDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(invalidDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Invalid version query skill',
    })
    writeSkillMd(createDir(validDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Valid version query skill',
    })

    const result = scanForIntents(root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.version).toBe('5.0.0')
    expect(result.packages[0]!.packageRoot).toBe(validDir)
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
    expect(() => scanForIntents(root)).toThrow('Deno without node_modules')
  })
})
