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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  runEditPackageJson,
  runEditPackageJsonAll,
  runSetupGithubActions,
} from '../src/setup.js'
import type { EditPackageJsonResult, MonorepoResult } from '../src/setup.js'

let root: string
let metaDir: string

function writePkg(data: Record<string, unknown>, indent?: number): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify(data, null, indent))
}

function readPkg(): Record<string, any> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'setup-test-'))
  metaDir = join(root, 'meta')

  // Create mock templates
  mkdirSync(join(metaDir, 'templates', 'workflows'), { recursive: true })

  writeFileSync(
    join(metaDir, 'templates', 'workflows', 'notify-intent.yml'),
    'package: {{PAYLOAD_PACKAGE}}\nrepo: {{REPO}}\npaths:\n  - {{DOCS_PATH}}\n  - {{SRC_PATH}}',
  )
  writeFileSync(
    join(metaDir, 'templates', 'workflows', 'check-skills.yml'),
    'label: {{PACKAGE_LABEL}}\ninstall: npm install -g @tanstack/intent',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('runEditPackageJson', () => {
  it('adds skills and !skills/_artifacts to files array', () => {
    writePkg({ name: 'test-pkg', files: ['dist', 'src'] }, 2)

    const result = runEditPackageJson(root)
    expect(result.added).toContain('files: "skills"')
    expect(result.added).toContain('files: "!skills/_artifacts"')

    const pkg = readPkg()
    expect(pkg.files).toContain('skills')
    expect(pkg.files).toContain('!skills/_artifacts')
    expect(pkg.files).toContain('dist')
    expect(pkg.files).toContain('src')
  })

  it('adds tanstack-intent keyword when keywords array is missing', () => {
    writePkg({ name: 'test-pkg', files: [] }, 2)

    const result = runEditPackageJson(root)
    expect(result.added).toContain('keywords: "tanstack-intent"')

    const pkg = readPkg()
    expect(pkg.keywords).toEqual(['tanstack-intent'])
  })

  it('adds tanstack-intent keyword to existing keywords array', () => {
    writePkg({ name: 'test-pkg', files: [], keywords: ['react', 'router'] }, 2)

    const result = runEditPackageJson(root)
    expect(result.added).toContain('keywords: "tanstack-intent"')

    const pkg = readPkg()
    expect(pkg.keywords).toContain('tanstack-intent')
    expect(pkg.keywords).toContain('react')
    expect(pkg.keywords).toContain('router')
  })

  it('reports already present when tanstack-intent keyword exists', () => {
    writePkg({ name: 'test-pkg', files: [], keywords: ['tanstack-intent'] }, 2)

    const result = runEditPackageJson(root)
    expect(result.alreadyPresent).toContain('keywords: "tanstack-intent"')
    expect(result.added).not.toEqual(
      expect.arrayContaining([expect.stringContaining('keywords')]),
    )
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

  it('preserves existing bin entries untouched', () => {
    writePkg(
      { name: 'test-pkg', files: [], bin: { 'my-cli': './bin/cli.js' } },
      2,
    )

    runEditPackageJson(root)

    const pkg = readPkg() as Record<string, unknown>
    const bin = pkg.bin as Record<string, string>
    expect(bin['my-cli']).toBe('./bin/cli.js')
    expect(bin.intent).toBeUndefined()
  })

  it('creates files array if missing', () => {
    writePkg({ name: 'test-pkg' }, 2)

    runEditPackageJson(root)

    const pkg = readPkg()
    expect(pkg.files).toContain('skills')
    expect(pkg.files).toContain('!skills/_artifacts')
  })

  it('returns empty result when no package.json exists', () => {
    const result = runEditPackageJson(root)
    expect(result.added).toHaveLength(0)
    expect(result.alreadyPresent).toHaveLength(0)
  })

  it('skips !skills/_artifacts in monorepo packages', () => {
    // Simulate monorepo by creating a parent package.json
    const monoRoot = mkdtempSync(join(tmpdir(), 'mono-root-'))
    const pkgDir = join(monoRoot, 'packages', 'my-lib')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      join(monoRoot, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
    )
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@scope/my-lib', files: ['dist'] }, null, 2),
    )

    const result = runEditPackageJson(pkgDir)
    expect(result.added).toContain('files: "skills"')
    expect(result.added).not.toEqual(
      expect.arrayContaining([expect.stringContaining('!skills/_artifacts')]),
    )

    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    expect(pkg.files).not.toContain('!skills/_artifacts')

    rmSync(monoRoot, { recursive: true, force: true })
  })

  it('skips !skills/_artifacts in pnpm workspace packages', () => {
    const monoRoot = createMonorepo()
    const pkgDir = join(monoRoot, 'packages', 'lib-a')

    const result = runEditPackageJson(pkgDir)

    expect(result.added).toContain('files: "skills"')
    expect(result.added).not.toEqual(
      expect.arrayContaining([expect.stringContaining('!skills/_artifacts')]),
    )

    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    expect(pkg.files).toContain('skills')
    expect(pkg.files).not.toContain('!skills/_artifacts')

    rmSync(monoRoot, { recursive: true, force: true })
  })

  it('updates the owning package when given a workspace skills dir path', () => {
    const monoRoot = createMonorepo()
    const pkgDir = join(monoRoot, 'packages', 'lib-a')
    const skillsDir = join(pkgDir, 'skills')

    const result = runEditPackageJson(skillsDir)

    expect(result.added).toContain('files: "skills"')

    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    expect(pkg.files).toContain('skills')
    expect(pkg.files).not.toContain('!skills/_artifacts')

    rmSync(monoRoot, { recursive: true, force: true })
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
    expect(result.workflows).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)

    const wfContent = readFileSync(
      join(root, '.github', 'workflows', 'notify-intent.yml'),
      'utf8',
    )
    expect(wfContent).toContain('package: @tanstack/query')
    expect(wfContent).toContain('repo: TanStack/query')
    expect(wfContent).toContain('paths:')
    expect(wfContent).toContain("'docs/**'")
  })

  it('copies templates with defaults when no package.json', () => {
    const result = runSetupGithubActions(root, metaDir)
    expect(result.workflows).toHaveLength(2)

    const wfPath = join(root, '.github', 'workflows', 'notify-intent.yml')
    expect(existsSync(wfPath)).toBe(true)
    const content = readFileSync(wfPath, 'utf8')
    expect(content).toContain('package: unknown')
  })

  it('skips existing workflow files', () => {
    runSetupGithubActions(root, metaDir)
    const result = runSetupGithubActions(root, metaDir)
    expect(result.workflows).toHaveLength(0)
    expect(result.skipped).toHaveLength(2)
  })

  it('handles missing templates directory gracefully', () => {
    const emptyMeta = join(root, 'empty-meta')
    mkdirSync(emptyMeta)
    const result = runSetupGithubActions(root, emptyMeta)
    expect(result.workflows).toHaveLength(0)
  })

  it('writes workflows to the workspace root with monorepo-aware substitutions', () => {
    const monoRoot = createMonorepo({
      packages: [
        { name: 'router', hasSkills: true },
        { name: 'start', hasSkills: true },
      ],
    })

    writeFileSync(
      join(monoRoot, 'package.json'),
      JSON.stringify(
        { name: 'root', private: true, workspaces: ['packages/*'] },
        null,
        2,
      ),
    )
    writeFileSync(
      join(monoRoot, 'packages', 'router', 'package.json'),
      JSON.stringify(
        {
          name: '@tanstack/react-router',
          intent: { repo: 'TanStack/router', docs: 'docs/' },
        },
        null,
        2,
      ),
    )
    mkdirSync(join(monoRoot, 'packages', 'router', 'src'), { recursive: true })
    mkdirSync(join(monoRoot, 'packages', 'router', 'docs'), { recursive: true })
    mkdirSync(join(monoRoot, 'packages', 'start', 'src'), { recursive: true })

    const result = runSetupGithubActions(
      join(monoRoot, 'packages', 'router'),
      metaDir,
    )

    expect(result.workflows).toEqual(
      expect.arrayContaining([
        join(monoRoot, '.github', 'workflows', 'notify-intent.yml'),
        join(monoRoot, '.github', 'workflows', 'check-skills.yml'),
      ]),
    )
    expect(
      existsSync(join(monoRoot, 'packages', 'router', '.github', 'workflows')),
    ).toBe(false)

    const notifyContent = readFileSync(
      join(monoRoot, '.github', 'workflows', 'notify-intent.yml'),
      'utf8',
    )
    expect(notifyContent).toContain('package: @tanstack/router')
    expect(notifyContent).toContain('repo: TanStack/router')
    expect(notifyContent).toContain("- 'packages/router/docs/**'")
    expect(notifyContent).toContain("- 'packages/router/src/**'")
    expect(notifyContent).toContain("- 'packages/start/src/**'")
    expect(notifyContent).not.toContain('packages/root/src/**')

    const checkContent = readFileSync(
      join(monoRoot, '.github', 'workflows', 'check-skills.yml'),
      'utf8',
    )
    expect(checkContent).toContain('label: @tanstack/router')
    expect(checkContent).toContain('npm install -g @tanstack/intent')

    rmSync(monoRoot, { recursive: true, force: true })
  })

  it('writes workflows to the Deno workspace root from a workspace package', () => {
    const monoRoot = createMonorepo({
      usePackageJsonWorkspaces: true,
      packages: [
        { name: 'router', hasSkills: true },
        { name: 'start', hasSkills: true },
      ],
    })

    writeFileSync(
      join(monoRoot, 'package.json'),
      JSON.stringify({ name: 'root', private: true }, null, 2),
    )
    writeFileSync(
      join(monoRoot, 'deno.jsonc'),
      `{
        // Deno workspace config should be used for monorepo resolution.
        "workspace": [
          "packages/*",
        ],
      }
      `,
    )
    writeFileSync(
      join(monoRoot, 'packages', 'router', 'package.json'),
      JSON.stringify(
        {
          name: '@tanstack/react-router',
          intent: { repo: 'TanStack/router', docs: 'docs/' },
        },
        null,
        2,
      ),
    )
    mkdirSync(join(monoRoot, 'packages', 'router', 'src'), { recursive: true })
    mkdirSync(join(monoRoot, 'packages', 'router', 'docs'), { recursive: true })
    mkdirSync(join(monoRoot, 'packages', 'start', 'src'), { recursive: true })

    const result = runSetupGithubActions(
      join(monoRoot, 'packages', 'router'),
      metaDir,
    )

    expect(result.workflows).toEqual(
      expect.arrayContaining([
        join(monoRoot, '.github', 'workflows', 'notify-intent.yml'),
        join(monoRoot, '.github', 'workflows', 'check-skills.yml'),
      ]),
    )
    expect(
      existsSync(join(monoRoot, 'packages', 'router', '.github', 'workflows')),
    ).toBe(false)

    const notifyContent = readFileSync(
      join(monoRoot, '.github', 'workflows', 'notify-intent.yml'),
      'utf8',
    )
    expect(notifyContent).toContain('package: @tanstack/router')
    expect(notifyContent).toContain('repo: TanStack/router')
    expect(notifyContent).toContain("- 'packages/router/docs/**'")
    expect(notifyContent).toContain("- 'packages/router/src/**'")
    expect(notifyContent).toContain("- 'packages/start/src/**'")

    rmSync(monoRoot, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// Monorepo-aware commands
// ---------------------------------------------------------------------------

/**
 * Helper: create a monorepo layout with pnpm-workspace.yaml,
 * workspace packages, and optional SKILL.md files.
 */
function createMonorepo(opts?: {
  usePackageJsonWorkspaces?: boolean
  packages?: Array<{ name: string; hasSkills?: boolean }>
}): string {
  const monoRoot = mkdtempSync(join(tmpdir(), 'mono-test-'))
  const packages = opts?.packages ?? [
    { name: 'lib-a', hasSkills: true },
    { name: 'lib-b', hasSkills: false },
  ]

  if (opts?.usePackageJsonWorkspaces) {
    writeFileSync(
      join(monoRoot, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2),
    )
  } else {
    writeFileSync(
      join(monoRoot, 'package.json'),
      JSON.stringify({ private: true }, null, 2),
    )
    writeFileSync(
      join(monoRoot, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n',
    )
  }

  for (const pkg of packages) {
    const pkgDir = join(monoRoot, 'packages', pkg.name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: `@scope/${pkg.name}`, files: ['dist'] }, null, 2),
    )
    if (pkg.hasSkills) {
      const skillDir = join(pkgDir, 'skills', 'core', 'setup')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: core/setup\ndescription: test\n---\n# Setup\n',
      )
    }
  }

  return monoRoot
}

describe('runEditPackageJsonAll', () => {
  it('updates only packages with skills in pnpm monorepo', () => {
    const monoRoot = createMonorepo()

    const results = runEditPackageJsonAll(monoRoot) as Array<
      MonorepoResult<EditPackageJsonResult>
    >

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(1)
    expect(results[0]!.package).toBe(join('packages', 'lib-a'))
    expect(results[0]!.result.added).toContain('files: "skills"')

    // lib-b should not have been modified
    const libBPkg = JSON.parse(
      readFileSync(join(monoRoot, 'packages', 'lib-b', 'package.json'), 'utf8'),
    )
    expect(libBPkg.files).toEqual(['dist'])

    rmSync(monoRoot, { recursive: true, force: true })
  })

  it('updates only packages with skills using package.json workspaces', () => {
    const monoRoot = createMonorepo({ usePackageJsonWorkspaces: true })

    const results = runEditPackageJsonAll(monoRoot) as Array<
      MonorepoResult<EditPackageJsonResult>
    >

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(1)
    expect(results[0]!.package).toBe(join('packages', 'lib-a'))

    rmSync(monoRoot, { recursive: true, force: true })
  })

  it('falls back to single-package when no workspace config exists', () => {
    writePkg({ name: 'test-pkg', files: ['dist'] }, 2)

    const result = runEditPackageJsonAll(root) as EditPackageJsonResult

    expect(Array.isArray(result)).toBe(false)
    expect(result.added).toContain('files: "skills"')
  })

  it('returns empty array when monorepo has no packages with skills', () => {
    const monoRoot = createMonorepo({
      packages: [
        { name: 'lib-a', hasSkills: false },
        { name: 'lib-b', hasSkills: false },
      ],
    })

    const results = runEditPackageJsonAll(monoRoot)

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(0)

    // Root package.json should NOT have been modified
    const rootPkg = JSON.parse(
      readFileSync(join(monoRoot, 'package.json'), 'utf8'),
    )
    expect(rootPkg.files).toBeUndefined()

    rmSync(monoRoot, { recursive: true, force: true })
  })
})
