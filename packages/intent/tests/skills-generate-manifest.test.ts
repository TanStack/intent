import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSkillsGenerateManifestCommand } from '../src/commands/skills/generate-manifest.js'
import { writeIntentManifest } from '../src/core/manifest.js'
import type { IntentManifest } from '../src/core/manifest.js'
import type { PolicedScan } from '../src/core/source-policy.js'
import type { IntentPackage, ScanResult } from '../src/shared/types.js'

function emptyScanResult(packages: Array<IntentPackage>): ScanResult {
  return {
    packageManager: 'npm',
    packages,
    warnings: [],
    notices: [],
    conflicts: [],
    nodeModules: {
      local: { root: null, packages: [] },
      global: { root: null, packages: [] },
    },
    stats: { packageJsonReadCount: 0, packageJsonCacheHits: 0 },
  } as unknown as ScanResult
}

function policedScan(packages: Array<IntentPackage>): PolicedScan {
  return {
    scan: emptyScanResult(packages),
    hiddenSourceCount: 0,
    hiddenSources: [],
    excludePatterns: [],
    droppedNames: [],
  }
}

describe('runSkillsGenerateManifestCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tempDirs: Array<string> = []

  afterEach(() => {
    logSpy.mockClear()
    vi.unstubAllEnvs()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makePackage(root?: string): IntentPackage {
    const packageRoot = root ?? mkdtempSync(join(tmpdir(), 'manifest-command-'))
    if (!root) tempDirs.push(packageRoot)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@acme/pkg', version: '1.0.0' }),
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(skillPath, '# Core\n\nGuidance.')
    return {
      name: '@acme/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: '', docs: '' },
      skills: [{ name: 'core', path: skillPath, description: '' }],
      packageRoot,
      kind: 'npm',
      source: 'local',
    }
  }

  function manifestPath(pkg: IntentPackage): string {
    return join(pkg.packageRoot, 'skills', 'intent.manifest.json')
  }

  function run(
    pkg: IntentPackage,
    options: Parameters<typeof runSkillsGenerateManifestCommand>[0],
    cwd = pkg.packageRoot,
  ): Promise<void> {
    return runSkillsGenerateManifestCommand(
      options,
      () => Promise.resolve(policedScan([pkg])),
      cwd,
    )
  }

  it('requires exactly one of --check or --write', async () => {
    const pkg = makePackage()

    await expect(run(pkg, {})).rejects.toMatchObject({
      message: expect.stringContaining('either --check or --write'),
    })
    await expect(run(pkg, { check: true, write: true })).rejects.toMatchObject({
      message: expect.stringContaining('either --check or --write'),
    })
  })

  it('--check fails without writing when the manifest is missing', async () => {
    const pkg = makePackage()

    await expect(run(pkg, { check: true })).rejects.toMatchObject({
      message: expect.stringContaining('generate-manifest --write'),
    })
    expect(existsSync(manifestPath(pkg))).toBe(false)
  })

  it('--write creates a manifest and --check accepts it', async () => {
    const pkg = makePackage()

    await run(pkg, { write: true })
    expect(existsSync(manifestPath(pkg))).toBe(true)

    logSpy.mockClear()
    await run(pkg, { check: true })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('up to date')
  })

  it('refuses to write a manifest containing a literal secret', async () => {
    const pkg = makePackage()
    const referencePath = join(
      pkg.packageRoot,
      'skills',
      'core',
      'references',
      'auth.md',
    )
    mkdirSync(dirname(referencePath), { recursive: true })
    writeFileSync(referencePath, `token = "ghp_${'a'.repeat(20)}"`)

    await expect(run(pkg, { write: true })).rejects.toThrow(
      /references\/auth\.md.*github-token/,
    )
    expect(existsSync(manifestPath(pkg))).toBe(false)
  })

  it('--write preserves authored declarations', async () => {
    const pkg = makePackage()
    const existing: IntentManifest = {
      manifestVersion: 1,
      package: pkg.name,
      packageVersion: pkg.version,
      skills: [
        {
          name: 'core',
          path: 'skills/core/SKILL.md',
          contentHash: 'sha256-old',
          capabilities: ['uses_network'],
          declaredSecrets: ['API_TOKEN'],
          mcpTools: [{ name: 'fetch', description: 'Fetch a resource.' }],
        },
      ],
    }
    writeIntentManifest(manifestPath(pkg), existing)

    await run(pkg, { write: true })

    expect(JSON.parse(readFileSync(manifestPath(pkg), 'utf8'))).toMatchObject({
      skills: [
        {
          capabilities: ['uses_network'],
          declaredSecrets: ['API_TOKEN'],
          mcpTools: [{ name: 'fetch', description: 'Fetch a resource.' }],
        },
      ],
    })
  })

  it('--write does not rewrite an identical manifest', async () => {
    const pkg = makePackage()
    await run(pkg, { write: true })
    const path = manifestPath(pkg)
    const oldTime = new Date('2020-01-01T00:00:00.000Z')
    utimesSync(path, oldTime, oldTime)
    const before = statSync(path).mtimeMs

    await run(pkg, { write: true })

    expect(statSync(path).mtimeMs).toBe(before)
  })

  it('fails closed without replacing a malformed manifest', async () => {
    const pkg = makePackage()
    writeFileSync(manifestPath(pkg), '{not json')

    await expect(run(pkg, { write: true })).rejects.toThrow(
      /Invalid intent.manifest.json/,
    )
    expect(readFileSync(manifestPath(pkg), 'utf8')).toBe('{not json')
  })

  it('allows --check but refuses --write in frozen mode', async () => {
    const pkg = makePackage()

    await expect(run(pkg, { check: true, frozen: true })).rejects.toMatchObject(
      {
        message: expect.stringContaining('generate-manifest --write'),
      },
    )
    await expect(run(pkg, { write: true, frozen: true })).rejects.toMatchObject(
      {
        message: expect.stringContaining('cannot write in frozen mode'),
        exitCode: 5,
      },
    )
  })

  it('refuses to write into an installed dependency', async () => {
    const consumerRoot = mkdtempSync(join(tmpdir(), 'manifest-consumer-'))
    tempDirs.push(consumerRoot)
    writeFileSync(
      join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true }),
    )
    const pkg = makePackage(join(consumerRoot, 'node_modules', '@acme', 'pkg'))

    await expect(run(pkg, { write: true }, consumerRoot)).rejects.toMatchObject(
      {
        message: expect.stringContaining('current package or workspace member'),
      },
    )
    expect(existsSync(manifestPath(pkg))).toBe(false)
  })

  it('writes manifests for workspace members', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'manifest-workspace-'))
    tempDirs.push(workspaceRoot)
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({
        name: 'workspace',
        private: true,
        workspaces: ['packages/*'],
      }),
    )
    const pkg = makePackage(join(workspaceRoot, 'packages', 'pkg'))
    pkg.kind = 'workspace'

    await run(pkg, { write: true }, workspaceRoot)

    expect(existsSync(manifestPath(pkg))).toBe(true)
  })
})
