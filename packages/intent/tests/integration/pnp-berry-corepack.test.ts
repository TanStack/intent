import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

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

function scaffoldBerryProject(): string {
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
  writeFileSync(
    join(pkgSrc, 'skills', 'core', 'SKILL.md'),
    '---\nname: core\ndescription: Core skill from the leaf package.\n---\n# Core\n',
  )
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
  return dir
}

describe.skipIf(!shouldRun)('Yarn Berry PnP (zip-backed dependencies)', () => {
  it('discovers and loads skills from a zip-backed dependency', () => {
    const cwd = scaffoldBerryProject()

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
  }, 120_000)
})
