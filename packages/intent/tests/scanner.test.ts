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
  root = mkdtempSync(join(tmpdir(), 'intent-test-'))
  globalRoot = mkdtempSync(join(tmpdir(), 'intent-global-test-'))
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
  it('returns empty packages when no node_modules exists', async () => {
    const result = await scanForIntents(root)
    expect(result.packages).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.nodeModules.local.exists).toBe(false)
  })

  it('returns empty packages when node_modules has no intent packages', async () => {
    createDir(root, 'node_modules', 'some-lib')
    writeJson(join(root, 'node_modules', 'some-lib', 'package.json'), {
      name: 'some-lib',
      version: '1.0.0',
    })
    const result = await scanForIntents(root)
    expect(result.packages).toEqual([])
  })

  it('discovers an intent-enabled package with skills', async () => {
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

    const result = await scanForIntents(root)
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

  it('discovers packages through symlinks (pnpm layout)', async () => {
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

    const result = await scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[0]!.skills).toHaveLength(1)
  })

  it('discovers unscoped packages through symlinks (pnpm layout)', async () => {
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

    const result = await scanForIntents(root)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('my-lib')
  })

  it('discovers sub-skills', async () => {
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

    const result = await scanForIntents(root)
    expect(result.packages[0]!.skills).toHaveLength(2)
    const names = result.packages[0]!.skills.map((s) => s.name)
    expect(names).toContain('db-core')
    expect(names).toContain('db-core/live-queries')
  })

  it('warns on skills/ dir without valid intent field', async () => {
    const pkgDir = createDir(root, 'node_modules', 'bad-pkg')
    writeJson(join(pkgDir, 'package.json'), {
      name: 'bad-pkg',
      version: '1.0.0',
      // no intent field
    })
    createDir(pkgDir, 'skills', 'some-skill')

    const result = await scanForIntents(root)
    expect(result.packages).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('bad-pkg')
  })

  it('warns on invalid intent version', async () => {
    const pkgDir = createDir(root, 'node_modules', 'wrong-ver')
    writeJson(join(pkgDir, 'package.json'), {
      name: 'wrong-ver',
      version: '1.0.0',
      intent: { version: 99, repo: 'foo/bar', docs: 'docs/' },
    })
    createDir(pkgDir, 'skills', 'some-skill')

    const result = await scanForIntents(root)
    expect(result.packages).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
  })

  it('sorts packages by dependency order (requires)', async () => {
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

    const result = await scanForIntents(root)
    expect(result.packages).toHaveLength(2)
    // Core should come first
    expect(result.packages[0]!.name).toBe('@tanstack/db')
    expect(result.packages[1]!.name).toBe('@tanstack/react-db')
  })

  it('skips packages without skills/ directory', async () => {
    const pkgDir = createDir(root, 'node_modules', 'no-skills')
    writeJson(join(pkgDir, 'package.json'), {
      name: 'no-skills',
      version: '1.0.0',
      intent: { version: 1, repo: 'foo/bar', docs: 'docs/' },
    })
    // No skills/ directory

    const result = await scanForIntents(root)
    expect(result.packages).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('discovers global-only intent packages', async () => {
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

    const result = await scanForIntents(root)

    expect(result.nodeModules.global.detected).toBe(true)
    expect(result.nodeModules.global.exists).toBe(true)
    expect(result.nodeModules.global.scanned).toBe(true)
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/query')
  })

  it('prefers local packages over global packages with the same name', async () => {
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

    const result = await scanForIntents(root)

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

  it('chooses the highest version when duplicate package names exist at the same depth', async () => {
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

    const result = await scanForIntents(root)
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
})

describe('package manager detection', () => {
  it('detects npm from package-lock.json', async () => {
    writeFileSync(join(root, 'package-lock.json'), '{}')
    createDir(root, 'node_modules')
    const result = await scanForIntents(root)
    expect(result.packageManager).toBe('npm')
  })

  it('detects pnpm from pnpm-lock.yaml', async () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    createDir(root, 'node_modules')
    const result = await scanForIntents(root)
    expect(result.packageManager).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', async () => {
    writeFileSync(join(root, 'yarn.lock'), '')
    createDir(root, 'node_modules')
    const result = await scanForIntents(root)
    expect(result.packageManager).toBe('yarn')
  })

  it('detects bun from bun.lockb', async () => {
    writeFileSync(join(root, 'bun.lockb'), '')
    createDir(root, 'node_modules')
    const result = await scanForIntents(root)
    expect(result.packageManager).toBe('bun')
  })

  it('returns unknown when no lockfile found', async () => {
    createDir(root, 'node_modules')
    const result = await scanForIntents(root)
    expect(result.packageManager).toBe('unknown')
  })

  it('throws for Yarn PnP', async () => {
    writeFileSync(join(root, '.pnp.cjs'), '')
    await expect(scanForIntents(root)).rejects.toThrow('Yarn PnP')
  })

  it('throws for Deno without node_modules', async () => {
    writeFileSync(join(root, 'deno.json'), '{}')
    // No node_modules dir
    await expect(scanForIntents(root)).rejects.toThrow(
      'Deno without node_modules',
    )
  })
})
