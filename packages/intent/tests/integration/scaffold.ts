import { execFileSync, execSync, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(thisDir, '..', 'fixtures', 'integration')
const cliPath = join(thisDir, '..', '..', 'dist', 'cli.mjs')
const realTmpdir = realpathSync(tmpdir())

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

// ---------------------------------------------------------------------------
// Verdaccio lifecycle
// ---------------------------------------------------------------------------

export interface Registry {
  url: string
  stop: () => void
}

export async function startRegistry(): Promise<Registry> {
  const storageDir = mkdtempSync(join(realTmpdir, 'verdaccio-storage-'))
  const port = await getFreePort()
  const configPath = join(storageDir, 'config.yaml')

  const htpasswdPath = join(storageDir, 'htpasswd')
  writeFileSync(htpasswdPath, '')

  writeFileSync(
    configPath,
    [
      `storage: ${storageDir}`,
      `listen: 127.0.0.1:${port}`,
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

  const isWindows = process.platform === 'win32'
  const verdaccioBin = join(
    thisDir,
    '..',
    '..',
    'node_modules',
    '.bin',
    'verdaccio',
  )

  return new Promise((resolve, reject) => {
    const child = spawn(
      isWindows ? `"${verdaccioBin}"` : verdaccioBin,
      isWindows
        ? ['--config', `"${configPath}"`, '--listen', `127.0.0.1:${port}`]
        : ['--config', configPath, '--listen', `127.0.0.1:${port}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: isWindows,
      },
    )

    let started = false
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill()
        reject(new Error('Verdaccio failed to start within 15s'))
      }
    }, 15_000)

    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('http address') || text.includes(`:${port}`)) {
        if (!started) {
          started = true
          clearTimeout(timeout)
          resolve({
            url: `http://127.0.0.1:${port}`,
            stop: () => {
              child.kill('SIGTERM')
              rmSync(storageDir, { recursive: true, force: true })
            },
          })
        }
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

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

  // Isolate npm cache + config to avoid EPERM on the host's ~/.npm and to keep
  // the shared fixture dirs read-only. Two integration suites publish in
  // parallel, so writing a .npmrc into the shared fixture dirs races (one
  // suite's cleanup deletes it before the other's publish reads it, causing
  // ENEEDAUTH). A per-call userconfig file avoids both that race and the
  // Windows-invalid `/dev/null` path.
  const cacheDir = mkdtempSync(join(realTmpdir, 'intent-npm-cache-'))
  const userconfigPath = join(cacheDir, 'npmrc')
  writeFileSync(userconfigPath, npmrc)

  try {
    // Order matters: leaf first, then wrappers that depend on it
    for (const pkg of ['skills-leaf', 'wrapper-1', 'wrapper-2', 'wrapper-3']) {
      const pkgDir = join(fixturesDir, pkg)
      execSync(
        `npm publish --registry ${registryUrl} --access public --provenance=false --cache="${cacheDir}" --userconfig="${userconfigPath}"`,
        { cwd: pkgDir, stdio: 'pipe' },
      )
    }
  } finally {
    rmSync(cacheDir, { recursive: true, force: true })
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
  pnp?: boolean
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
      ...(opts.pnp ? { installConfig: { pnp: true } } : {}),
      dependencies: { [opts.dependency]: '1.0.0' },
    })
    install(root, opts.pm, opts.registryUrl, opts)
    return { root, cwd: root }
  }

  // Monorepo
  writeJson(join(root, 'package.json'), {
    name: 'test-monorepo',
    private: true,
    ...(opts.pm !== 'pnpm' ? { workspaces: ['packages/*'] } : {}),
    ...(opts.pnp ? { installConfig: { pnp: true } } : {}),
  })
  if (opts.pm === 'pnpm') {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
  }
  if (opts.pm === 'yarn' && !opts.pnp) {
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
  }

  const appDir = join(root, 'packages', 'app')
  mkdirSync(appDir, { recursive: true })
  writeJson(join(appDir, 'package.json'), {
    name: '@test/app',
    version: '1.0.0',
    dependencies: { [opts.dependency]: '1.0.0' },
  })

  install(root, opts.pm, opts.registryUrl, opts)

  return {
    root,
    cwd: opts.structure === 'monorepo-root' ? root : appDir,
  }
}

function install(
  dir: string,
  pm: PackageManager,
  registryUrl: string,
  opts: { pnp?: boolean } = {},
): void {
  const yarnCache = join(dir, '.yarn-cache')
  mkdirSync(yarnCache, { recursive: true })
  const env = {
    ...process.env,
    npm_config_registry: registryUrl,
    YARN_CACHE_FOLDER: yarnCache,
  }
  const reg = `--registry=${registryUrl}`

  switch (pm) {
    case 'npm':
      runInstallCommand(`npm install ${reg}`, dir, env)
      break
    case 'pnpm':
      runInstallCommand(`pnpm install ${reg} --no-frozen-lockfile`, dir, env)
      break
    case 'yarn':
      runInstallCommand(
        `yarn install ${reg}${opts.pnp ? ' --enable-pnp' : ''} --cache-folder ${yarnCache}`,
        dir,
        env,
      )
      break
    case 'bun':
      runInstallCommand(`bun install ${reg}`, dir, env)
      break
  }
}

function runInstallCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  try {
    execSync(command, { cwd, env, stdio: 'pipe' })
  } catch (error) {
    throw new Error(formatInstallError(command, cwd, error))
  }
}

function formatInstallError(
  command: string,
  cwd: string,
  error: unknown,
): string {
  const processError = error as {
    message?: string
    signal?: NodeJS.Signals
    status?: number
    stderr?: Buffer | string
    stdout?: Buffer | string
  }
  const lines = [`Command failed: ${command}`, `cwd: ${cwd}`]

  if (typeof processError.status === 'number') {
    lines.push(`exit code: ${processError.status}`)
  }
  if (processError.signal) {
    lines.push(`signal: ${processError.signal}`)
  }

  const stdout = commandOutputToString(processError.stdout)
  if (stdout) {
    lines.push(`stdout:\n${stdout}`)
  }

  const stderr = commandOutputToString(processError.stderr)
  if (stderr) {
    lines.push(`stderr:\n${stderr}`)
  }

  if (!stdout && !stderr && processError.message) {
    lines.push(processError.message)
  }

  return lines.join('\n')
}

function commandOutputToString(output: Buffer | string | undefined): string {
  if (!output) {
    return ''
  }

  return output.toString().trim()
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

const packageManagerAvailability = new Map<PackageManager, boolean>()

export function isPackageManagerAvailable(pm: PackageManager): boolean {
  const cached = packageManagerAvailability.get(pm)
  if (cached !== undefined) return cached

  let available: boolean
  try {
    execSync(`${pm} --version`, { stdio: 'ignore', cwd: realTmpdir })
    available = true
  } catch {
    available = false
  }

  packageManagerAvailability.set(pm, available)
  return available
}

let symlinkCapable: boolean | undefined

export function canSymlink(): boolean {
  if (symlinkCapable !== undefined) return symlinkCapable

  const probeDir = mkdtempSync(join(realTmpdir, 'intent-symlink-probe-'))
  try {
    const target = join(probeDir, 'target')
    writeFileSync(target, '')
    symlinkSync(target, join(probeDir, 'link'))
    symlinkCapable = true
  } catch {
    symlinkCapable = false
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }

  return symlinkCapable
}

export function isYarnClassic(): boolean {
  try {
    const version = execSync('yarn --version', {
      encoding: 'utf8',
      cwd: realTmpdir,
    }).trim()
    return Number.parseInt(version.split('.')[0]!, 10) === 1
  } catch {
    return false
  }
}

export function runScanner(
  cwd: string,
  method: 'direct' | 'symlink' = 'direct',
): CliResult {
  let binPath = cliPath
  let linkDir: string | undefined

  if (method === 'symlink') {
    linkDir = mkdtempSync(join(realTmpdir, 'intent-link-'))
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
  } finally {
    if (linkDir) {
      rmSync(linkDir, { recursive: true, force: true })
    }
  }
}

export interface RunLoadOptions {
  method?: 'direct' | 'symlink'
  path?: boolean
  json?: boolean
}

export function runLoad(
  cwd: string,
  use: string,
  options: RunLoadOptions = {},
): CliResult {
  const method = options.method ?? 'direct'
  let binPath = cliPath
  let linkDir: string | undefined

  if (method === 'symlink') {
    linkDir = mkdtempSync(join(realTmpdir, 'intent-link-'))
    const linkPath = join(linkDir, 'intent-cli.mjs')
    symlinkSync(cliPath, linkPath)
    binPath = linkPath
  }

  const args: Array<string> = [binPath, 'load', use]
  if (options.path) args.push('--path')
  if (options.json) args.push('--json')

  try {
    const stdout = execFileSync('node', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      stdout,
      stderr: '',
      exitCode: 0,
      parsed: options.json ? JSON.parse(stdout) : null,
    }
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
      parsed: null,
    }
  } finally {
    if (linkDir) {
      rmSync(linkDir, { recursive: true, force: true })
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
