import { execSync, execFileSync } from 'node:child_process'
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
  const { runServer } = await import('@verdaccio/node-api')

  const storageDir = mkdtempSync(join(realTmpdir, 'verdaccio-storage-'))
  const port = 6000 + Math.floor(Math.random() * 4000)
  const configPath = join(storageDir, 'config.yaml')

  writeFileSync(
    configPath,
    [
      `storage: ${storageDir}`,
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
      'log: { type: stdout, format: pretty, level: fatal }',
    ].join('\n'),
  )

  const app = await runServer(configPath)

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve({
        url: `http://localhost:${port}`,
        stop: () => {
          server.close()
          rmSync(storageDir, { recursive: true, force: true })
        },
      })
    })
    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Publishing fixtures
// ---------------------------------------------------------------------------

export function publishFixtures(registryUrl: string): void {
  // Order matters: leaf first, then wrappers that depend on it
  for (const pkg of ['skills-leaf', 'wrapper-1', 'wrapper-2', 'wrapper-3']) {
    execSync(`npm publish --registry ${registryUrl} --access public`, {
      cwd: join(fixturesDir, pkg),
      stdio: 'ignore',
    })
  }
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
