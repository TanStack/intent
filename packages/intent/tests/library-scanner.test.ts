import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanLibrary } from '../src/library-scanner.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Simulate the script path as it would appear in a library's bin/intent.js shim.
// findHomeDir walks up from dirname(scriptPath) to find the nearest package.json.
function shimPath(pkgDir: string): string {
  return join(pkgDir, 'bin', 'intent.js')
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'library-scanner-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanLibrary', () => {
  it('returns the home package with its skills', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.2.0',
      description: 'Type-safe router for React',
      bin: { intent: './bin/intent.js' },
    })
    const skillDir = createDir(pkgDir, 'skills', 'routing')
    writeSkillMd(skillDir, {
      name: 'routing',
      description: 'File-based route definitions',
    })

    const result = scanLibrary(shimPath(pkgDir), root)

    expect(result.warnings).toEqual([])
    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.name).toBe('@tanstack/router')
    expect(result.packages[0]!.version).toBe('1.2.0')
    expect(result.packages[0]!.description).toBe('Type-safe router for React')
    expect(result.packages[0]!.skills).toHaveLength(1)
    expect(result.packages[0]!.skills[0]!.name).toBe('routing')
    expect(result.packages[0]!.skills[0]!.description).toBe(
      'File-based route definitions',
    )
  })

  it('includes the full path to each SKILL.md', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      bin: { intent: './bin/intent.js' },
    })
    const skillDir = createDir(pkgDir, 'skills', 'routing')
    writeSkillMd(skillDir, { name: 'routing', description: 'Routing patterns' })

    const result = scanLibrary(shimPath(pkgDir), root)

    const skill = result.packages[0]!.skills[0]!
    expect(skill.path).toBe(join(pkgDir, 'skills', 'routing', 'SKILL.md'))
  })

  it('recursively discovers deps with bin.intent', () => {
    // Home package: @tanstack/router, depends on @tanstack/query
    const routerDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(routerDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      description: 'Router',
      bin: { intent: './bin/intent.js' },
      dependencies: { '@tanstack/query': '^5.0.0' },
    })
    const routerSkill = createDir(routerDir, 'skills', 'routing')
    writeSkillMd(routerSkill, {
      name: 'routing',
      description: 'Route definitions',
    })

    // Dep package: @tanstack/query
    const queryDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(queryDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      description: 'Async state management',
      bin: { intent: './bin/intent.js' },
    })
    const querySkill = createDir(queryDir, 'skills', 'fetching')
    writeSkillMd(querySkill, {
      name: 'fetching',
      description: 'Query and mutation patterns',
    })

    const result = scanLibrary(shimPath(routerDir), root)

    expect(result.warnings).toEqual([])
    expect(result.packages).toHaveLength(2)

    const names = result.packages.map((p) => p.name)
    expect(names).toContain('@tanstack/router')
    expect(names).toContain('@tanstack/query')

    const query = result.packages.find((p) => p.name === '@tanstack/query')!
    expect(query.skills[0]!.name).toBe('fetching')
    expect(query.skills[0]!.description).toBe('Query and mutation patterns')
  })

  it('discovers deps via peerDependencies', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      bin: { intent: './bin/intent.js' },
      peerDependencies: { '@tanstack/query': '^5.0.0' },
    })

    const queryDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(queryDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      bin: { intent: './bin/intent.js' },
    })
    const querySkill = createDir(queryDir, 'skills', 'fetching')
    writeSkillMd(querySkill, { name: 'fetching', description: 'Fetching' })

    const result = scanLibrary(shimPath(pkgDir), root)

    const names = result.packages.map((p) => p.name)
    expect(names).toContain('@tanstack/query')
  })

  it('skips deps without bin.intent', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      bin: { intent: './bin/intent.js' },
      dependencies: { react: '^18.0.0' },
    })

    const reactDir = createDir(root, 'node_modules', 'react')
    writeJson(join(reactDir, 'package.json'), {
      name: 'react',
      version: '18.0.0',
      // no bin.intent
    })
    const reactSkill = createDir(reactDir, 'skills', 'hooks')
    writeSkillMd(reactSkill, { name: 'hooks', description: 'React hooks' })

    const result = scanLibrary(shimPath(pkgDir), root)

    const names = result.packages.map((p) => p.name)
    expect(names).not.toContain('react')
  })

  it('handles packages with no skills/ directory', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      bin: { intent: './bin/intent.js' },
    })
    // No skills/ directory

    const result = scanLibrary(shimPath(pkgDir), root)

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]!.skills).toEqual([])
  })

  it('does not visit the same package twice (cycle detection)', () => {
    // router -> query -> router (circular)
    const routerDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(routerDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      bin: { intent: './bin/intent.js' },
      dependencies: { '@tanstack/query': '^5.0.0' },
    })

    const queryDir = createDir(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(queryDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      bin: { intent: './bin/intent.js' },
      dependencies: { '@tanstack/router': '^1.0.0' }, // circular back
    })

    const result = scanLibrary(shimPath(routerDir), root)

    // Each package appears exactly once
    const names = result.packages.map((p) => p.name)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })

  it('discovers sub-skills within a package', () => {
    const pkgDir = createDir(root, 'node_modules', '@tanstack', 'router')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      bin: { intent: './bin/intent.js' },
    })
    const routingDir = createDir(pkgDir, 'skills', 'routing')
    writeSkillMd(routingDir, {
      name: 'routing',
      description: 'Routing overview',
    })
    const nestedDir = createDir(routingDir, 'nested-routes')
    writeSkillMd(nestedDir, {
      name: 'routing/nested-routes',
      description: 'Nested route patterns',
    })

    const result = scanLibrary(shimPath(pkgDir), root)

    const skills = result.packages[0]!.skills
    expect(skills).toHaveLength(2)
    const names = skills.map((s) => s.name)
    expect(names).toContain('routing')
    expect(names).toContain('routing/nested-routes')
  })

  it('returns a warning when home package.json cannot be found', () => {
    const fakeScript = join(root, 'nowhere', 'bin', 'intent.js')

    const result = scanLibrary(fakeScript, root)

    expect(result.packages).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/home package/i)
  })
})
