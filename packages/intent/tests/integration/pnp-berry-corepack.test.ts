import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { computeSourceContentHash } from '../../src/core/lockfile/hash.js'

/**
 * Regression guard for discussion #119: skill discovery in a real Yarn Berry
 * (v4) project that uses `nodeLinker: pnp` and has no `node_modules`, where
 * dependencies live inside `.yarn/cache/*.zip`. The project is generated with
 * `corepack` at test time and a skill-bearing dependency is installed as a
 * tarball so Yarn stores it in the zip cache (the shape that triggered #119).
 *
 * Reading inside the zip cache requires Yarn's libzip-patched `fs`. A synthetic
 * `.pnp.cjs` with a no-op `setup()` does not reproduce that, so this uses a real
 * Yarn install. The built CLI is run from the project cwd while Intent itself
 * lives outside the project's PnP graph — the exact `npx`/`dlx` invocation from
 * the report.
 *
 * On CI this test must run (it does not skip silently), so a #119 regression
 * always surfaces. Locally it is skipped only when corepack/Yarn Berry cannot be
 * set up (e.g. offline), to keep the suite runnable without network.
 */

const YARN_VERSION = '4.12.0'
// Bound every external command so a stalled corepack/npm/node cannot hang CI:
// execFileSync is synchronous, so Vitest's test timeout cannot interrupt it.
const CMD_TIMEOUT_MS = 90_000
const isCI = Boolean(process.env.CI)
const thisDir = dirname(fileURLToPath(import.meta.url))
const cliPath = join(thisDir, '..', '..', 'dist', 'cli.mjs')
const realTmpdir = realpathSync(tmpdir())

// Never block on corepack's interactive download prompt in a non-TTY shell.
const corepackEnv = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
const skillContent =
  '---\nname: core\ndescription: Core skill from the leaf package.\n---\n# Core\n'

function berryAvailable(): boolean {
  try {
    // Run in a neutral cwd so a repo `packageManager` pin does not interfere.
    execFileSync('corepack', [`yarn@${YARN_VERSION}`, '--version'], {
      cwd: realTmpdir,
      env: corepackEnv,
      stdio: 'ignore',
      timeout: CMD_TIMEOUT_MS,
    })
    return true
  } catch {
    return false
  }
}

// On CI, always run so a regression is loud. Locally, skip when Berry is
// unavailable (offline) instead of failing the suite.
const shouldRun = isCI || berryAvailable()

const tempDirs: Array<string> = []

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

function writeSkillPackage(packageRoot: string): string {
  const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
  mkdirSync(dirname(skillPath), { recursive: true })
  writeFileSync(skillPath, skillContent)
  const skillDir = dirname(skillPath)
  mkdirSync(join(skillDir, 'references'), { recursive: true })
  writeFileSync(join(skillDir, 'references', 'guide.md'), '# Guide\n')
  mkdirSync(join(skillDir, 'assets'), { recursive: true })
  writeFileSync(join(skillDir, 'assets', 'data.bin'), Buffer.from([0x00, 0xff]))
  mkdirSync(join(skillDir, 'scripts'), { recursive: true })
  writeFileSync(join(skillDir, 'scripts', 'run.mjs'), 'export {}\n')
  return skillPath
}

function hashSkillPackage(packageRoot: string, skillPath: string): string {
  return computeSourceContentHash(packageRoot, [
    { relativePath: 'skills/core/SKILL.md', absolutePath: skillPath },
  ]).contentHash
}

function scaffoldBerryProject(): { root: string; packageSourceRoot: string } {
  const dir = mkdtempSync(join(realTmpdir, 'intent-berry-corepack-'))
  tempDirs.push(dir)

  // A skill-bearing package, packed to a tarball so Yarn stores it in the zip
  // cache (the shape that triggered discussion #119).
  const pkgSrc = join(dir, 'leaf-src')
  mkdirSync(join(pkgSrc, 'skills', 'core'), { recursive: true })
  writeJson(join(pkgSrc, 'package.json'), {
    name: '@repro/skills-leaf',
    version: '1.0.0',
    intent: { version: 1, repo: 'repro/leaf', docs: 'https://example.com' },
    repository: { type: 'git', url: 'git+https://github.com/repro/leaf.git' },
  })
  writeSkillPackage(pkgSrc)
  execFileSync('npm', ['pack', '--pack-destination', dir], {
    cwd: pkgSrc,
    timeout: CMD_TIMEOUT_MS,
  })
  const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack did not produce a tarball')

  writeFileSync(
    join(dir, '.yarnrc.yml'),
    'nodeLinker: pnp\nenableGlobalCache: false\n',
  )
  writeJson(join(dir, 'package.json'), {
    name: 'berry-corepack-repro',
    packageManager: `yarn@${YARN_VERSION}`,
    dependencies: { '@repro/skills-leaf': `file:./${tarball}` },
  })

  // CI makes Berry installs immutable by default; this fixture creates lockfile fresh.
  execFileSync('corepack', ['yarn', 'install', '--no-immutable'], {
    cwd: dir,
    stdio: 'pipe',
    env: corepackEnv,
    timeout: CMD_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  })
  return { root: dir, packageSourceRoot: pkgSrc }
}

describe.skipIf(!shouldRun)('Yarn Berry PnP (zip-backed dependencies)', () => {
  it('discovers, loads, and hashes skills from a zip-backed dependency', () => {
    const { root: cwd, packageSourceRoot } = scaffoldBerryProject()

    const list = execFileSync('node', [cliPath, 'list', '--json'], {
      cwd,
      encoding: 'utf8',
      timeout: CMD_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    })
    const parsed = JSON.parse(list)
    expect(parsed.packages.map((p: { name: string }) => p.name)).toContain(
      '@repro/skills-leaf',
    )
    expect(
      parsed.skills.map((s: { skillName: string }) => s.skillName),
    ).toContain('core')

    const load = execFileSync(
      'node',
      [cliPath, 'load', '@repro/skills-leaf#core'],
      {
        cwd,
        encoding: 'utf8',
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
      },
    )
    expect(load).toContain('# Core')

    execFileSync('node', [cliPath, 'skills', 'approve', '--all', '--yes'], {
      cwd,
      encoding: 'utf8',
      timeout: CMD_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    })

    const expectedHash = hashSkillPackage(
      packageSourceRoot,
      join(packageSourceRoot, 'skills', 'core', 'SKILL.md'),
    )
    const lockfile = JSON.parse(
      readFileSync(join(cwd, 'intent.lock'), 'utf8'),
    ) as { sources: Array<{ id: string; contentHash: string }> }
    const pnpHash = lockfile.sources.find(
      (source) => source.id === '@repro/skills-leaf',
    )?.contentHash

    const npmRoot = join(
      cwd,
      'npm-layout',
      'node_modules',
      '@repro',
      'skills-leaf',
    )
    const pnpmRoot = join(
      cwd,
      'pnpm-layout',
      'node_modules',
      '.pnpm',
      '@repro+skills-leaf@1.0.0',
      'node_modules',
      '@repro',
      'skills-leaf',
    )
    const workspaceRoot = join(
      cwd,
      'workspace-layout',
      'packages',
      'skills-leaf',
    )
    const layoutHashes = [
      hashSkillPackage(npmRoot, writeSkillPackage(npmRoot)),
      hashSkillPackage(pnpmRoot, writeSkillPackage(pnpmRoot)),
      hashSkillPackage(workspaceRoot, writeSkillPackage(workspaceRoot)),
    ]

    expect(pnpHash).toBe(expectedHash)
    expect(layoutHashes).toEqual([expectedHash, expectedHash, expectedHash])
  }, 120_000)
})
