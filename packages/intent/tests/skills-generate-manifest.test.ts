import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSkillsGenerateManifestCommand } from '../src/commands/skills/generate-manifest.js'
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
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makePackage(): IntentPackage {
    const packageRoot = mkdtempSync(join(tmpdir(), 'generate-manifest-'))
    tempDirs.push(packageRoot)
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@acme/pkg', version: '1.0.0' }),
    )
    const skillDir = join(packageRoot, 'skills', 'core')
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    writeFileSync(skillPath, '# Core\n\nGuidance text.')

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

  function makeConsumerWithInstalledPackage(): {
    consumerRoot: string
    installed: IntentPackage
  } {
    const consumerRoot = mkdtempSync(join(tmpdir(), 'manifest-consumer-'))
    tempDirs.push(consumerRoot)
    writeFileSync(
      join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true }),
    )
    const packageRoot = join(consumerRoot, 'node_modules', '@acme', 'pkg')
    const skillDir = join(packageRoot, 'skills', 'core')
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    writeFileSync(skillPath, '# Core\n\nGuidance text.')

    return {
      consumerRoot,
      installed: {
        name: '@acme/pkg',
        version: '1.0.0',
        intent: { version: 1, repo: '', docs: '' },
        skills: [{ name: 'core', path: skillPath, description: '' }],
        packageRoot,
        kind: 'npm',
        source: 'local',
      },
    }
  }

  it('writes a manifest file for a discovered package', async () => {
    const pkg = makePackage()

    await runSkillsGenerateManifestCommand(
      {},
      () => Promise.resolve(policedScan([pkg])),
      pkg.packageRoot,
    )

    const manifestPath = join(pkg.packageRoot, 'skills', 'intent.manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(manifest.package).toBe('@acme/pkg')
    expect(manifest.skills).toHaveLength(1)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Wrote')
  })

  it('refuses to write a manifest into an installed dependency', async () => {
    const { consumerRoot, installed } = makeConsumerWithInstalledPackage()

    await expect(
      runSkillsGenerateManifestCommand(
        {},
        () => Promise.resolve(policedScan([installed])),
        consumerRoot,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('current package or workspace member'),
    })

    expect(
      existsSync(join(installed.packageRoot, 'skills', 'intent.manifest.json')),
    ).toBe(false)
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
    const packageRoot = join(workspaceRoot, 'packages', 'pkg')
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@acme/pkg', version: '1.0.0' }),
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(skillPath, '# Core\n\nGuidance text.')
    const pkg: IntentPackage = {
      name: '@acme/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: '', docs: '' },
      skills: [{ name: 'core', path: skillPath, description: '' }],
      packageRoot,
      kind: 'workspace',
      source: 'local',
    }

    await runSkillsGenerateManifestCommand(
      {},
      () => Promise.resolve(policedScan([pkg])),
      workspaceRoot,
    )

    expect(
      existsSync(join(packageRoot, 'skills', 'intent.manifest.json')),
    ).toBe(true)
  })

  it('refuses to generate manifests in frozen mode', async () => {
    const pkg = makePackage()

    await expect(
      runSkillsGenerateManifestCommand(
        { frozen: true },
        () => Promise.resolve(policedScan([pkg])),
        pkg.packageRoot,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('cannot run in frozen mode'),
      exitCode: 5,
    })
  })

  it('reports no packages found when discovery is empty', async () => {
    await runSkillsGenerateManifestCommand({}, () =>
      Promise.resolve(policedScan([])),
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('No intent-enabled packages found.')
  })

  it('fails (and does not write) when a skill body contains a literal secret', async () => {
    const pkg = makePackage()
    writeFileSync(
      pkg.skills[0]!.path,
      'export GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef',
    )

    await expect(
      runSkillsGenerateManifestCommand(
        {},
        () => Promise.resolve(policedScan([pkg])),
        pkg.packageRoot,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('literal secret value'),
    })

    const manifestPath = join(pkg.packageRoot, 'skills', 'intent.manifest.json')
    expect(existsSync(manifestPath)).toBe(false)
  })

  it('outputs JSON with per-package results when --json is passed', async () => {
    const pkg = makePackage()

    await runSkillsGenerateManifestCommand(
      { json: true },
      () => Promise.resolve(policedScan([pkg])),
      pkg.packageRoot,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    const parsed = JSON.parse(output)
    expect(parsed).toEqual([
      {
        id: '@acme/pkg',
        kind: 'npm',
        status: 'written',
        path: join(pkg.packageRoot, 'skills', 'intent.manifest.json'),
      },
    ])
  })
})
