import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('writes a manifest file for a discovered package', async () => {
    const pkg = makePackage()

    await runSkillsGenerateManifestCommand(
      {},
      () => Promise.resolve(policedScan([pkg])),
    )

    const manifestPath = join(pkg.packageRoot, 'skills', 'intent.manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(manifest.package).toBe('@acme/pkg')
    expect(manifest.skills).toHaveLength(1)

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Wrote')
  })

  it('reports no packages found when discovery is empty', async () => {
    await runSkillsGenerateManifestCommand({}, () => Promise.resolve(policedScan([])))

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
