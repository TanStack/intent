import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForIntents, scanIntentPackageAtRoot } from '../src/scanner.js'

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
const requireFromTest = createRequire(import.meta.url)

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
    expect(result.stats).toEqual(
      expect.objectContaining({
        packageJsonReadCount: expect.any(Number),
        packageJsonCacheHits: expect.any(Number),
      }),
    )
    expect(result.stats!.packageJsonReadCount).toBeGreaterThan(0)
  })

  it('does not throw when skills exists but is not a directory', () => {
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
    writeFileSync(join(pkgDir, 'skills'), 'not a directory')

    const result = scanForIntents(root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[0]!.skills).toEqual([])
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

  it('still discovers undeclared packages from broad node_modules scans', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: {
        'declared-skill-pkg': '1.0.0',
      },
    })

    const declaredDir = createDir(root, 'node_modules', 'declared-skill-pkg')
    writeJson(join(declaredDir, 'package.json'), {
      name: 'declared-skill-pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/declared', docs: 'docs/' },
    })
    writeSkillMd(createDir(declaredDir, 'skills', 'declared'), {
      name: 'declared',
      description: 'Declared skill',
    })

    const undeclaredDir = createDir(
      root,
      'node_modules',
      'undeclared-skill-pkg',
    )
    writeJson(join(undeclaredDir, 'package.json'), {
      name: 'undeclared-skill-pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/undeclared', docs: 'docs/' },
    })
    writeSkillMd(createDir(undeclaredDir, 'skills', 'undeclared'), {
      name: 'undeclared',
      description: 'Undeclared skill',
    })

    const result = scanForIntents(root)

    expect(result.packages.map((pkg) => pkg.name).sort()).toEqual([
      'declared-skill-pkg',
      'undeclared-skill-pkg',
    ])
    expect(result.nodeModules.local.scanned).toBe(true)
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

    const result = scanForIntents(root, { includeGlobal: true })

    expect(result.nodeModules.global.detected).toBe(true)
    expect(result.nodeModules.global.exists).toBe(true)
    expect(result.nodeModules.global.scanned).toBe(true)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/query')
    expect(result.packages[0]!.source).toBe('global')
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

    const result = scanForIntents(root, { includeGlobal: true })

    expect(result.nodeModules.global.detected).toBe(true)
    expect(result.nodeModules.global.scanned).toBe(true)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.source).toBe('local')
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

    const result = scanForIntents(root)

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

    const result = scanForIntents(root)
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

  it('keeps same-name packages at different installed roots as separate variants', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: {
        'router-consumer': '1.0.0',
      },
    })

    const hoistedRouterDir = createDir(
      root,
      'node_modules',
      '@tanstack',
      'router',
    )
    writeJson(join(hoistedRouterDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      intent: { version: 1, repo: 'TanStack/router', docs: 'docs/' },
    })
    writeSkillMd(createDir(hoistedRouterDir, 'skills', 'router-v1'), {
      name: 'router-v1',
      description: 'Router v1 skill',
    })

    const consumerDir = createDir(root, 'node_modules', 'router-consumer')
    writeJson(join(consumerDir, 'package.json'), {
      name: 'router-consumer',
      version: '1.0.0',
      dependencies: {
        '@tanstack/router': '2.0.0',
      },
    })

    const nestedRouterDir = createDir(
      consumerDir,
      'node_modules',
      '@tanstack',
      'router',
    )
    writeJson(join(nestedRouterDir, 'package.json'), {
      name: '@tanstack/router',
      version: '2.0.0',
      intent: { version: 1, repo: 'TanStack/router', docs: 'docs/' },
    })
    writeSkillMd(createDir(nestedRouterDir, 'skills', 'router-v2'), {
      name: 'router-v2',
      description: 'Router v2 skill',
    })

    const result = scanForIntents(root)
    const conflict = result.conflicts.find(
      (item) => item.packageName === '@tanstack/router',
    )

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/router')
    expect(conflict?.variants).toEqual(
      expect.arrayContaining([
        { version: '1.0.0', packageRoot: hoistedRouterDir },
        { version: '2.0.0', packageRoot: nestedRouterDir },
      ]),
    )
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

  it('prefers project node_modules over stale PnP state', () => {
    const missingPkgJson = join(
      root,
      '.yarn',
      'cache',
      'bun-wrapper.zip',
      'node_modules',
      'bun-wrapper',
      'package.json',
    )

    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      dependencies: { 'bun-wrapper': '1.0.0' },
    })
    writeFileSync(
      join(root, '.pnp.cjs'),
      [
        "const Module = require('node:module')",
        `const missingPkgJson = ${JSON.stringify(missingPkgJson)}`,
        'module.exports = {',
        '  setup() {',
        '    const originalResolve = Module._resolveFilename',
        '    Module._resolveFilename = function(request, parent, isMain, options) {',
        "      if (request === 'bun-wrapper/package.json') return missingPkgJson",
        '      return originalResolve.call(this, request, parent, isMain, options)',
        '    }',
        '  },',
        '  getDependencyTreeRoots() { return [] },',
        '  getPackageInformation() { return null },',
        '}',
        '',
      ].join('\n'),
    )

    const wrapperDir = createDir(
      root,
      'node_modules',
      '.bun',
      'bun-wrapper@1.0.0',
      'node_modules',
      'bun-wrapper',
    )
    writeJson(join(wrapperDir, 'package.json'), {
      name: 'bun-wrapper',
      version: '1.0.0',
      dependencies: { 'bun-skills-pkg': '1.0.0' },
    })

    const skillsPkgDir = createDir(
      root,
      'node_modules',
      '.bun',
      'bun-skills-pkg@1.0.0',
      'node_modules',
      'bun-skills-pkg',
    )
    writeJson(join(skillsPkgDir, 'package.json'), {
      name: 'bun-skills-pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/skills', docs: 'https://example.com' },
    })
    writeSkillMd(createDir(skillsPkgDir, 'skills', 'core'), {
      name: 'core',
      description: 'Core skill',
    })

    createDir(root, 'node_modules')
    symlinkSync(wrapperDir, join(root, 'node_modules', 'bun-wrapper'))
    createDir(wrapperDir, 'node_modules')
    symlinkSync(
      skillsPkgDir,
      join(wrapperDir, 'node_modules', 'bun-skills-pkg'),
    )

    const result = scanForIntents(root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('bun-skills-pkg')
    expect(result.warnings).toEqual([])
  })

  it('falls back to Yarn PnP when stale node_modules has no intent packages', () => {
    const reactStartDir = createDir(
      root,
      '.yarn',
      '__virtual__',
      '@tanstack-react-start-virtual',
      '0',
      'cache',
      '@tanstack-react-start-npm-1.167.52.zip',
      'node_modules',
      '@tanstack',
      'react-start',
    )

    writeJson(join(root, 'package.json'), {
      name: 'tanstack-intent-pnp-repro',
      version: '0.0.0',
      private: true,
      packageManager: 'yarn@4.12.0',
      dependencies: {
        '@tanstack/react-start': '1.167.52',
      },
    })
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: pnp\n')
    writeJson(join(reactStartDir, 'package.json'), {
      name: '@tanstack/react-start',
      version: '1.167.52',
      intent: {
        version: 1,
        repo: 'TanStack/router',
        docs: 'https://tanstack.com/start',
      },
      repository: {
        type: 'git',
        url: 'git+https://github.com/TanStack/router.git',
        directory: 'packages/react-start',
      },
      homepage: 'https://tanstack.com/start',
    })
    writeSkillMd(createDir(reactStartDir, 'skills', 'react-start'), {
      name: 'react-start',
      description: 'React Start skill',
    })
    writeSkillMd(
      createDir(reactStartDir, 'skills', 'lifecycle', 'migrate-from-nextjs'),
      {
        name: 'lifecycle/migrate-from-nextjs',
        description: 'Migration skill',
      },
    )
    writeSkillMd(
      createDir(reactStartDir, 'skills', 'react-start', 'server-components'),
      {
        name: 'react-start/server-components',
        description: 'Server components skill',
      },
    )

    writeFileSync(
      join(root, '.pnp.cjs'),
      [
        `const projectRoot = ${JSON.stringify(`${root}${sep}`)}`,
        `const reactStartRoot = ${JSON.stringify(`${reactStartDir}${sep}`)}`,
        "const rootLocator = { name: 'tanstack-intent-pnp-repro', reference: 'workspace:.' }",
        "const reactStartLocator = { name: '@tanstack/react-start', reference: 'virtual:test#npm:1.167.52' }",
        'module.exports = {',
        '  getDependencyTreeRoots() { return [rootLocator] },',
        '  findPackageLocator(location) {',
        '    if (location.startsWith(projectRoot)) return rootLocator',
        '    if (location.startsWith(reactStartRoot)) return reactStartLocator',
        '    return null',
        '  },',
        '  getPackageInformation(locator) {',
        "    if (locator.name === 'tanstack-intent-pnp-repro') {",
        '      return {',
        '        packageLocation: projectRoot,',
        "        packageDependencies: new Map([['@tanstack/react-start', 'virtual:test#npm:1.167.52']]),",
        '      }',
        '    }',
        "    if (locator.name === '@tanstack/react-start') {",
        '      return {',
        '        packageLocation: reactStartRoot,',
        '        packageDependencies: new Map(),',
        '      }',
        '    }',
        '    return null',
        '  },',
        '}',
        '',
      ].join('\n'),
    )
    createDir(root, 'node_modules')

    const result = scanForIntents(root)

    expect(result.packageManager).toBe('yarn')
    expect(result.nodeModules.local.exists).toBe(true)
    expect(result.nodeModules.local.scanned).toBe(true)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/react-start')
    expect(
      result.packages[0]!.skills.map((skill) => skill.name).sort(),
    ).toEqual([
      'lifecycle/migrate-from-nextjs',
      'react-start',
      'react-start/server-components',
    ])
    expect(result.warnings).toEqual([])
  })

  it('uses the project Yarn PnP API when another PnP API is active', () => {
    const reactStartDir = createDir(
      root,
      '.yarn',
      '__virtual__',
      '@tanstack-react-start-virtual',
      '0',
      'cache',
      '@tanstack-react-start-npm-1.167.52.zip',
      'node_modules',
      '@tanstack',
      'react-start',
    )

    writeJson(join(root, 'package.json'), {
      name: 'tanstack-intent-pnp-repro',
      version: '0.0.0',
      private: true,
      packageManager: 'yarn@4.12.0',
      dependencies: {
        '@tanstack/react-start': '1.167.52',
      },
    })
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: pnp\n')
    writeJson(join(reactStartDir, 'package.json'), {
      name: '@tanstack/react-start',
      version: '1.167.52',
      repository: {
        type: 'git',
        url: 'git+https://github.com/TanStack/router.git',
        directory: 'packages/react-start',
      },
      homepage: 'https://tanstack.com/start',
    })
    writeSkillMd(createDir(reactStartDir, 'skills', 'react-start'), {
      name: 'react-start',
      description: 'React Start skill',
    })
    writeSkillMd(
      createDir(reactStartDir, 'skills', 'lifecycle', 'migrate-from-nextjs'),
      {
        name: 'lifecycle/migrate-from-nextjs',
        description: 'Migration skill',
      },
    )
    writeSkillMd(
      createDir(reactStartDir, 'skills', 'react-start', 'server-components'),
      {
        name: 'react-start/server-components',
        description: 'Server components skill',
      },
    )

    writeFileSync(
      join(root, '.pnp.cjs'),
      [
        `const projectRoot = ${JSON.stringify(`${root}${sep}`)}`,
        `const reactStartRoot = ${JSON.stringify(`${reactStartDir}${sep}`)}`,
        "const rootLocator = { name: 'tanstack-intent-pnp-repro', reference: 'workspace:.' }",
        "const reactStartLocator = { name: '@tanstack/react-start', reference: 'virtual:test#npm:1.167.52' }",
        'module.exports = {',
        '  setup() {},',
        '  getDependencyTreeRoots() { return [rootLocator] },',
        '  findPackageLocator(location) {',
        '    if (location.startsWith(projectRoot)) return rootLocator',
        '    if (location.startsWith(reactStartRoot)) return reactStartLocator',
        '    return null',
        '  },',
        '  getPackageInformation(locator) {',
        "    if (locator.name === 'tanstack-intent-pnp-repro') {",
        '      return {',
        '        packageLocation: projectRoot,',
        "        packageDependencies: new Map([['@tanstack/react-start', 'virtual:test#npm:1.167.52']]),",
        '      }',
        '    }',
        "    if (locator.name === '@tanstack/react-start') {",
        '      return {',
        '        packageLocation: reactStartRoot,',
        '        packageDependencies: new Map(),',
        '      }',
        '    }',
        '    return null',
        '  },',
        '}',
        '',
      ].join('\n'),
    )

    const moduleApi = requireFromTest('node:module') as {
      findPnpApi?: () => unknown
    }
    const previousFindPnpApi = moduleApi.findPnpApi
    moduleApi.findPnpApi = () => ({
      getDependencyTreeRoots() {
        return [{ name: 'wrong-project', reference: 'workspace:.' }]
      },
      getPackageInformation() {
        return {
          packageLocation: `${root}${sep}`,
          packageDependencies: new Map(),
        }
      },
    })

    try {
      const result = scanForIntents(root)

      expect(result.packages).toHaveLength(1)
      expect(result.packages[0]!.name).toBe('@tanstack/react-start')
      expect(
        result.packages[0]!.skills.map((skill) => skill.name).sort(),
      ).toEqual([
        'lifecycle/migrate-from-nextjs',
        'react-start',
        'react-start/server-components',
      ])
    } finally {
      if (previousFindPnpApi) {
        moduleApi.findPnpApi = previousFindPnpApi
      } else {
        delete moduleApi.findPnpApi
      }
    }
  })

  it('falls back to Yarn PnP when workspace discovery finds packages first', () => {
    const reactStartDir = createDir(
      root,
      '.yarn',
      '__virtual__',
      '@tanstack-react-start-virtual',
      '0',
      'cache',
      '@tanstack-react-start-npm-1.167.52.zip',
      'node_modules',
      '@tanstack',
      'react-start',
    )
    const appDir = createDir(root, 'packages', 'app')
    const workspaceSkillDir = createDir(
      appDir,
      'node_modules',
      'workspace-skill-pkg',
    )

    writeJson(join(root, 'package.json'), {
      name: 'tanstack-intent-pnp-monorepo',
      version: '0.0.0',
      private: true,
      packageManager: 'yarn@4.12.0',
      workspaces: ['packages/*'],
      dependencies: {
        '@tanstack/react-start': '1.167.52',
      },
    })
    writeJson(join(appDir, 'package.json'), {
      name: '@test/app',
      version: '0.0.0',
      dependencies: {
        'workspace-skill-pkg': '1.0.0',
      },
    })
    writeJson(join(workspaceSkillDir, 'package.json'), {
      name: 'workspace-skill-pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/workspace', docs: 'docs/' },
    })
    writeSkillMd(createDir(workspaceSkillDir, 'skills', 'core'), {
      name: 'core',
      description: 'Workspace skill',
    })
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: pnp\n')
    writeJson(join(reactStartDir, 'package.json'), {
      name: '@tanstack/react-start',
      version: '1.167.52',
      intent: {
        version: 1,
        repo: 'TanStack/router',
        docs: 'https://tanstack.com/start',
      },
      repository: {
        type: 'git',
        url: 'git+https://github.com/TanStack/router.git',
        directory: 'packages/react-start',
      },
      homepage: 'https://tanstack.com/start',
    })
    writeSkillMd(createDir(reactStartDir, 'skills', 'react-start'), {
      name: 'react-start',
      description: 'React Start skill',
    })

    writeFileSync(
      join(root, '.pnp.cjs'),
      [
        `const projectRoot = ${JSON.stringify(`${root}${sep}`)}`,
        `const reactStartRoot = ${JSON.stringify(`${reactStartDir}${sep}`)}`,
        "const rootLocator = { name: 'tanstack-intent-pnp-monorepo', reference: 'workspace:.' }",
        "const reactStartLocator = { name: '@tanstack/react-start', reference: 'virtual:test#npm:1.167.52' }",
        'module.exports = {',
        '  getDependencyTreeRoots() { return [rootLocator] },',
        '  findPackageLocator(location) {',
        '    if (location.startsWith(projectRoot)) return rootLocator',
        '    if (location.startsWith(reactStartRoot)) return reactStartLocator',
        '    return null',
        '  },',
        '  getPackageInformation(locator) {',
        "    if (locator.name === 'tanstack-intent-pnp-monorepo') {",
        '      return {',
        '        packageLocation: projectRoot,',
        "        packageDependencies: new Map([['@tanstack/react-start', 'virtual:test#npm:1.167.52']]),",
        '      }',
        '    }',
        "    if (locator.name === '@tanstack/react-start') {",
        '      return {',
        '        packageLocation: reactStartRoot,',
        '        packageDependencies: new Map(),',
        '      }',
        '    }',
        '    return null',
        '  },',
        '}',
        '',
      ].join('\n'),
    )
    createDir(root, 'node_modules')

    const result = scanForIntents(root)

    expect(result.packages.map((pkg) => pkg.name).sort()).toEqual([
      '@tanstack/react-start',
      'workspace-skill-pkg',
    ])
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

  it('falls back to bounded nested node_modules discovery through symlinks', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
    })

    const wrapperDir = createDir(root, 'node_modules', 'wrapper')
    writeJson(join(wrapperDir, 'package.json'), {
      name: 'wrapper',
      version: '1.0.0',
    })

    const skillPkgDir = createDir(root, 'store', '@tanstack', 'query')
    writeJson(join(skillPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      dependencies: {
        '@tanstack/store': '1.0.0',
      },
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(skillPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query fetching skill',
    })
    const transitiveSkillPkgDir = createDir(
      skillPkgDir,
      'node_modules',
      '@tanstack',
      'store',
    )
    writeJson(join(transitiveSkillPkgDir, 'package.json'), {
      name: '@tanstack/store',
      version: '1.0.0',
      intent: { version: 1, repo: 'TanStack/store', docs: 'docs/' },
    })
    writeSkillMd(createDir(transitiveSkillPkgDir, 'skills', 'store'), {
      name: 'store',
      description: 'Store skill',
    })

    createDir(wrapperDir, 'node_modules', '@tanstack')
    symlinkSync(
      skillPkgDir,
      join(wrapperDir, 'node_modules', '@tanstack', 'query'),
      'dir',
    )
    symlinkSync(
      join(root, 'node_modules'),
      join(wrapperDir, 'node_modules', 'loop'),
      'dir',
    )

    const result = scanForIntents(root)

    expect(result.packages.map((pkg) => pkg.name).sort()).toEqual([
      '@tanstack/query',
      '@tanstack/store',
    ])
    expect(result.stats!.packageJsonReadCount).toBeLessThan(10)
  })

  it('does not crawl package source trees during nested node_modules discovery', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
    })

    const wrapperDir = createDir(root, 'node_modules', 'wrapper')
    writeJson(join(wrapperDir, 'package.json'), {
      name: 'wrapper',
      version: '1.0.0',
    })

    const sourcePackageDir = createDir(
      wrapperDir,
      'src',
      'node_modules',
      '@tanstack',
      'query',
    )
    writeJson(join(sourcePackageDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(sourcePackageDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query fetching skill',
    })

    const result = scanForIntents(root)

    expect(result.packages).toEqual([])
    expect(result.stats!.packageJsonReadCount).toBeLessThan(4)
  })

  it('dedupes recursive workspace symlink paths by real package identity', () => {
    writeJson(join(root, 'package.json'), {
      name: 'workspace-root',
      private: true,
      workspaces: ['packages/*'],
      dependencies: { a: 'workspace:*' },
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )

    const aDir = createDir(root, 'packages', 'a')
    const bDir = createDir(root, 'packages', 'b')
    writeJson(join(aDir, 'package.json'), {
      name: 'a',
      version: '1.0.0',
      exports: { '.': './index.js' },
      dependencies: { b: 'workspace:*' },
    })
    writeFileSync(join(aDir, 'index.js'), '')
    writeJson(join(bDir, 'package.json'), {
      name: 'b',
      version: '1.0.0',
      intent: { version: 1, repo: 'example/b', docs: 'docs/' },
      exports: { '.': './index.js' },
      dependencies: { a: 'workspace:*' },
    })
    writeFileSync(join(bDir, 'index.js'), '')
    writeSkillMd(createDir(bDir, 'skills', 'core'), {
      name: 'core',
      description: 'Core skill',
    })

    createDir(root, 'node_modules')
    symlinkSync(aDir, join(root, 'node_modules', 'a'), 'dir')
    createDir(aDir, 'node_modules')
    createDir(bDir, 'node_modules')
    symlinkSync(bDir, join(aDir, 'node_modules', 'b'), 'dir')
    symlinkSync(aDir, join(bDir, 'node_modules', 'a'), 'dir')

    const result = scanForIntents(root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('b')
    expect(result.stats!.packageJsonReadCount).toBeLessThan(10)
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

  it('uses semver coercion when comparing messy package versions', () => {
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
      dependencies: { '@tanstack/query': 'release-5.0.1' },
    })
    writeJson(join(consumerBDir, 'package.json'), {
      name: 'consumer-b',
      version: '1.0.0',
      dependencies: { '@tanstack/query': '5.0.0' },
    })

    const messyDir = createDir(
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

    writeJson(join(messyDir, 'package.json'), {
      name: '@tanstack/query',
      version: 'release-5.0.1',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeJson(join(validDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(createDir(messyDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Messy version query skill',
    })
    writeSkillMd(createDir(validDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Valid version query skill',
    })

    const result = scanForIntents(root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.version).toBe('release-5.0.1')
    expect(result.packages[0]!.packageRoot).toBe(messyDir)
  })
})

describe('scanIntentPackageAtRoot', () => {
  it('can scan only the hinted skill path', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: {
        version: 1,
        repo: 'TanStack/query',
        docs: 'docs/',
      },
    })
    writeSkillMd(createDir(pkgDir, 'skills', 'query', 'core'), {
      name: 'query/core',
      description: 'Core query skill',
    })
    writeSkillMd(createDir(pkgDir, 'skills', 'query', 'cache'), {
      name: 'query/cache',
      description: 'Cache query skill',
    })

    const result = scanIntentPackageAtRoot(pkgDir, {
      fallbackName: '@tanstack/query',
      projectRoot: root,
      skillNameHint: 'query/cache',
    })

    expect(result.package?.skills).toEqual([
      {
        name: 'query/cache',
        path: 'node_modules/@tanstack/query/skills/query/cache/SKILL.md',
        description: 'Cache query skill',
        type: undefined,
        framework: undefined,
      },
    ])
  })

  it('can scan a package-prefixed hinted skill path from a short name', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router-core')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router-core',
      version: '1.0.0',
      intent: {
        version: 1,
        repo: 'TanStack/router',
        docs: 'docs/',
      },
    })
    writeSkillMd(
      createDir(pkgDir, 'skills', 'router-core', 'auth-and-guards'),
      {
        name: 'router-core/auth-and-guards',
        description: 'Router auth and guards',
      },
    )

    const result = scanIntentPackageAtRoot(pkgDir, {
      fallbackName: '@tanstack/router-core',
      projectRoot: root,
      skillNameHint: 'auth-and-guards',
    })

    expect(result.package?.skills).toEqual([
      {
        name: 'router-core/auth-and-guards',
        path: 'node_modules/@tanstack/router-core/skills/router-core/auth-and-guards/SKILL.md',
        description: 'Router auth and guards',
        type: undefined,
        framework: undefined,
      },
    ])
  })

  it('falls back when the hinted path has a different canonical skill name', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: {
        version: 1,
        repo: 'TanStack/query',
        docs: 'docs/',
      },
    })
    writeSkillMd(createDir(pkgDir, 'skills', 'cache'), {
      name: 'query/cache',
      description: 'Cache query skill',
    })

    const result = scanIntentPackageAtRoot(pkgDir, {
      fallbackName: '@tanstack/query',
      projectRoot: root,
      skillNameHint: 'cache',
    })

    expect(result.package?.skills).toEqual([])
  })

  it('does not follow hinted skill paths outside the skills directory', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: {
        version: 1,
        repo: 'TanStack/query',
        docs: 'docs/',
      },
    })
    createDir(pkgDir, 'skills')
    writeSkillMd(createDir(pkgDir, 'outside'), {
      name: '../outside',
      description: 'Escaped skill',
    })

    const result = scanIntentPackageAtRoot(pkgDir, {
      fallbackName: '@tanstack/query',
      projectRoot: root,
      skillNameHint: '../outside',
    })

    expect(result.package?.skills).toEqual([])
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

  it('throws for Deno without node_modules', () => {
    writeFileSync(join(root, 'deno.json'), '{}')
    expect(() => scanForIntents(root)).toThrow('Deno without node_modules')
  })
})
