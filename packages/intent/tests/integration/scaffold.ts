import { execSync, execFileSync, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(thisDir, '..', 'fixtures', 'integration')
const cliPath = join(thisDir, '..', '..', 'dist', 'cli.mjs')
const realTmpdir = realpathSync(tmpdir())

// ---------------------------------------------------------------------------
// Verdaccio lifecycle
// ---------------------------------------------------------------------------

export interface Registry {
  url: string
  stop: () => void
}

export async function startRegistry(): Promise<Registry> {
  const storageDir = mkdtempSync(join(realTmpdir, 'verdaccio-storage-'))
  const port = 6000 + Math.floor(Math.random() * 4000)
  const configPath = join(storageDir, 'config.yaml')

  const htpasswdPath = join(storageDir, 'htpasswd')
  writeFileSync(htpasswdPath, '')

  writeFileSync(
    configPath,
    [
      `storage: ${storageDir}`,
      `listen: 0.0.0.0:${port}`,
      'auth:',
      '  htpasswd:',
      `    file: ${htpasswdPath}`,
      '    max_users: 100',
      'uplinks:',
      '  npmjs:',
      '    url: https://registry.npmjs.org/',
      'packages:',
      "  '@test-intent/*':",
      '    access: $all',
      '    publish: $all',
      "  '**':",
      '    access: $all',
      '    proxy: npmjs',
      'log: { type: stdout, format: pretty, level: warn }',
    ].join('\n'),
  )

  const verdaccioBin = join(thisDir, '..', '..', 'node_modules', '.bin', 'verdaccio')

  return new Promise((resolve, reject) => {
    const child = spawn(verdaccioBin, ['--config', configPath, '--listen', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    let started = false
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill()
        reject(new Error('Verdaccio failed to start within 15s'))
      }
    }, 15_000)

    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('http address') || text.includes('warn') || text.includes('---')) {
        if (!started) {
          started = true
          clearTimeout(timeout)
          resolve({
            url: `http://localhost:${port}`,
            stop: () => {
              child.kill('SIGTERM')
              rmSync(storageDir, { recursive: true, force: true })
            },
          })
        }
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout)
        reject(new Error(`Verdaccio exited with code ${code} before starting`))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Publishing fixtures
// ---------------------------------------------------------------------------

export function publishFixtures(registryUrl: string): void {
  const host = new URL(registryUrl).host
  const npmrc = `//${host}/:_authToken=test-token\nregistry=${registryUrl}\n`

  // Isolate npm cache to avoid EPERM on the host's ~/.npm/_cacache
  const cacheDir = mkdtempSync(join(realTmpdir, 'intent-npm-cache-'))

  // Order matters: leaf first, then wrappers that depend on it
  for (const pkg of ['skills-leaf', 'wrapper-1', 'wrapper-2', 'wrapper-3']) {
    const pkgDir = join(fixturesDir, pkg)
    writeFileSync(join(pkgDir, '.npmrc'), npmrc)
    try {
      execSync(
        `npm publish --registry ${registryUrl} --access public --provenance=false --cache=${cacheDir} --userconfig=/dev/null`,
        { cwd: pkgDir, stdio: 'pipe' },
      )
    } finally {
      rmSync(join(pkgDir, '.npmrc'), { force: true })
    }
  }

  rmSync(cacheDir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Project scaffolding
// ---------------------------------------------------------------------------

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type ProjectStructure = 'single' | 'monorepo-root' | 'monorepo-workspace'

interface ScaffoldResult {
  root: string
  cwd: string
}

export function scaffoldProject(opts: {
  pm: PackageManager
  structure: ProjectStructure
  dependency: string
  registryUrl: string
}): ScaffoldResult {
  const root = mkdtempSync(join(realTmpdir, `intent-integ-${opts.pm}-`))

  // Lockfile marker so detectPackageManager works
  const lockfiles: Record<PackageManager, string> = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lock',
  }
  writeFileSync(join(root, lockfiles[opts.pm]), '')

  if (opts.structure === 'single') {
    writeJson(join(root, 'package.json'), {
      name: 'test-project',
      private: true,
      dependencies: { [opts.dependency]: '1.0.0' },
    })
    install(root, opts.pm, opts.registryUrl)
    return { root, cwd: root }
  }

  // Monorepo
  writeJson(join(root, 'package.json'), {
    name: 'test-monorepo',
    private: true,
    ...(opts.pm !== 'pnpm' ? { workspaces: ['packages/*'] } : {}),
  })
  if (opts.pm === 'pnpm') {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  }
  if (opts.pm === 'yarn') {
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
  }

  const appDir = join(root, 'packages', 'app')
  mkdirSync(appDir, { recursive: true })
  writeJson(join(appDir, 'package.json'), {
    name: '@test/app',
    version: '1.0.0',
    dependencies: { [opts.dependency]: '1.0.0' },
  })

  install(root, opts.pm, opts.registryUrl)

  return {
    root,
    cwd: opts.structure === 'monorepo-root' ? root : appDir,
  }
}

function install(dir: string, pm: PackageManager, registryUrl: string): void {
  const env = { ...process.env, npm_config_registry: registryUrl }
  const reg = `--registry=${registryUrl}`

  switch (pm) {
    case 'npm':
      execSync(`npm install ${reg}`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'pnpm':
      execSync(`pnpm install ${reg} --no-frozen-lockfile`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'yarn':
      execSync(`yarn install ${reg}`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'bun':
      execSync(`bun install ${reg}`, { cwd: dir, stdio: 'ignore', env })
      break
  }
}

// ---------------------------------------------------------------------------
// CLI invocation
// ---------------------------------------------------------------------------

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
  parsed: any
}

export function runScanner(
  cwd: string,
  method: 'direct' | 'symlink' = 'direct',
): CliResult {
  let binPath = cliPath

  if (method === 'symlink') {
    const linkDir = mkdtempSync(join(realTmpdir, 'intent-link-'))
    const linkPath = join(linkDir, 'intent-cli.mjs')
    symlinkSync(cliPath, linkPath)
    binPath = linkPath
  }

  try {
    const stdout = execFileSync('node', [binPath, 'list', '--json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', exitCode: 0, parsed: JSON.parse(stdout) }
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
      parsed: null,
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
