import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeIntentDeliveryConfig } from '../src/commands/install/delivery.js'
import { buildCurrentLockfileSources } from '../src/core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { scanForIntents } from '../src/discovery/scanner.js'
import { packageVersionToPin } from '../src/shared/command-runner.js'
import { isMainModule, main } from '../src/cli.js'

const thisDir = dirname(fileURLToPath(import.meta.url))
const metaDir = join(thisDir, '..', 'meta')
const packageJsonPath = join(thisDir, '..', 'package.json')
const intentPackagePin = packageVersionToPin(
  (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string })
    .version,
)
const realTmpdir = realpathSync(tmpdir())

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeAllowAllConsumer(root: string): void {
  writeJson(join(root, 'package.json'), {
    name: 'app',
    private: true,
    intent: { skills: ['*'] },
  })
}

function writeIntentLock(
  root: string,
  packages: Parameters<typeof buildCurrentLockfileSources>[0] = [],
): void {
  writeIntentLockfile(join(root, 'intent.lock'), {
    lockfileVersion: 1,
    sources: buildCurrentLockfileSources(packages),
  })
}

function writeSkillMd(dir: string, frontmatter: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  const yamlLines = Object.entries(frontmatter)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? `"${value}"` : value}`,
    )
    .join('\n')

  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\n${yamlLines}\n---\n\nSkill content here.\n`,
  )
}

function writeInstalledIntentPackage(
  root: string,
  {
    description,
    name,
    skillName,
    version,
  }: {
    description: string
    name: string
    skillName: string
    version: string
  },
): void {
  const consumerPackageJsonPath = join(root, 'package.json')
  const consumerPackageJson = existsSync(consumerPackageJsonPath)
    ? (JSON.parse(readFileSync(consumerPackageJsonPath, 'utf8')) as Record<
        string,
        unknown
      >)
    : { name: 'app', private: true }
  const consumerIntent =
    consumerPackageJson.intent &&
    typeof consumerPackageJson.intent === 'object' &&
    !Array.isArray(consumerPackageJson.intent)
      ? (consumerPackageJson.intent as Record<string, unknown>)
      : {}
  const consumerDependencies =
    consumerPackageJson.dependencies &&
    typeof consumerPackageJson.dependencies === 'object' &&
    !Array.isArray(consumerPackageJson.dependencies)
      ? (consumerPackageJson.dependencies as Record<string, unknown>)
      : {}
  writeJson(consumerPackageJsonPath, {
    ...consumerPackageJson,
    dependencies: { ...consumerDependencies, [name]: version },
    intent: {
      ...consumerIntent,
      ...(!Object.hasOwn(consumerIntent, 'skills') ? { skills: ['*'] } : {}),
    },
  })

  const pkgDir = join(root, 'node_modules', ...name.split('/'))
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version,
    intent: { version: 1, repo: 'TanStack/test', docs: 'docs/' },
  })
  writeSkillMd(join(pkgDir, 'skills', skillName), {
    name: skillName,
    description,
  })
}

function writeConflictingQueryPackages(root: string): {
  queryV4Dir: string
  queryV5Dir: string
} {
  writeJson(join(root, 'package.json'), {
    name: 'app',
    private: true,
    intent: { skills: ['*'] },
    dependencies: {
      'consumer-a': '1.0.0',
      'consumer-b': '1.0.0',
    },
  })

  const consumerADir = join(root, 'node_modules', 'consumer-a')
  const consumerBDir = join(root, 'node_modules', 'consumer-b')
  const queryV4Dir = join(consumerADir, 'node_modules', '@tanstack', 'query')
  const queryV5Dir = join(consumerBDir, 'node_modules', '@tanstack', 'query')

  writeJson(join(consumerADir, 'package.json'), {
    name: 'consumer-a',
    version: '1.0.0',
    dependencies: { '@tanstack/query': '4.0.0' },
  })
  writeJson(join(consumerBDir, 'package.json'), {
    name: 'consumer-b',
    version: '1.0.0',
    dependencies: { '@tanstack/query': '5.0.0' },
  })
  writeJson(join(queryV4Dir, 'package.json'), {
    name: '@tanstack/query',
    version: '4.0.0',
    intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
  })
  writeJson(join(queryV5Dir, 'package.json'), {
    name: '@tanstack/query',
    version: '5.0.0',
    intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
  })
  writeSkillMd(join(queryV4Dir, 'skills', 'fetching'), {
    name: 'fetching',
    description: 'Query v4 skill',
  })
  writeSkillMd(join(queryV5Dir, 'skills', 'fetching'), {
    name: 'fetching',
    description: 'Query v5 skill',
  })

  return { queryV4Dir, queryV5Dir }
}

let originalCwd: string
let logSpy: ReturnType<typeof vi.spyOn>
let infoSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
let tempDirs: Array<string>
let previousGlobalNodeModules: string | undefined
let previousNoNotices: string | undefined
let previousIntentAudience: string | undefined

function getHelpOutput(): string {
  return [...infoSpy.mock.calls, ...logSpy.mock.calls]
    .map((call) => String(call[0] ?? ''))
    .join('')
}

beforeEach(() => {
  originalCwd = process.cwd()
  tempDirs = []
  previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES
  previousNoNotices = process.env.INTENT_NO_NOTICES
  previousIntentAudience = process.env.INTENT_AUDIENCE
  delete process.env.INTENT_GLOBAL_NODE_MODULES
  delete process.env.INTENT_NO_NOTICES
  delete process.env.INTENT_AUDIENCE
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  stdoutWriteSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (previousGlobalNodeModules === undefined) {
    delete process.env.INTENT_GLOBAL_NODE_MODULES
  } else {
    process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
  }
  if (previousNoNotices === undefined) {
    delete process.env.INTENT_NO_NOTICES
  } else {
    process.env.INTENT_NO_NOTICES = previousNoNotices
  }
  if (previousIntentAudience === undefined) {
    delete process.env.INTENT_AUDIENCE
  } else {
    process.env.INTENT_AUDIENCE = previousIntentAudience
  }
  logSpy.mockRestore()
  infoSpy.mockRestore()
  errorSpy.mockRestore()
  stdoutWriteSpy.mockRestore()
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('intent meta', () => {
  it('lists the shipped public meta-skills', async () => {
    const exitCode = await main(['meta'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Meta-skills')
    expect(output).toContain('domain-discovery')
    expect(output).toContain('tree-generator')
    expect(output).toContain('generate-skill')
    expect(output).toContain('skill-staleness-check')
  })

  it('prints the requested meta-skill content', async () => {
    const expected = readFileSync(
      join(metaDir, 'domain-discovery', 'SKILL.md'),
      'utf8',
    )

    const exitCode = await main(['meta', 'domain-discovery'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expected)
  })

  it('fails cleanly for invalid meta-skill names', async () => {
    const exitCode = await main(['meta', '../bad'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Invalid meta-skill name: "../bad"')
  })

  it('fails cleanly when a meta-skill does not exist', async () => {
    const exitCode = await main(['meta', 'missing-skill'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Meta-skill "missing-skill" not found. Run `intent meta` to list available meta-skills.',
    )
  })
})

describe('cli commands', () => {
  it('prints top-level help when no command is provided', async () => {
    const exitCode = await main([])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('Usage:')
    expect(output).toContain('$ intent <command> [options]')
    expect(output).toContain('Commands:')
  })

  it('prints top-level help for --help', async () => {
    const exitCode = await main(['--help'])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('Usage:')
    expect(output).toContain('$ intent <command> [options]')
  })

  it('prints top-level help for unknown commands', async () => {
    const exitCode = await main(['wat'])
    const output = getHelpOutput()

    expect(exitCode).toBe(1)
    expect(output).toContain('Usage:')
    expect(output).toContain('Commands:')
  })

  it('prints command help for help subcommands', async () => {
    const exitCode = await main(['help', 'validate'])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('$ intent validate [dir]')
  })

  it('fails cleanly for unknown help subcommands', async () => {
    const exitCode = await main(['help', 'wat'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Unknown command: wat')
  })

  it('prints command help when --help is passed after a subcommand', async () => {
    const exitCode = await main(['list', '--help'])
    const output = getHelpOutput()

    expect(exitCode).toBe(0)
    expect(output).toContain('$ intent list [--json]')
    expect(output).toContain('--json')
    expect(output).toContain('--show-hidden')
  })

  it('omits the removed non-interactive install and standalone hook options from help', async () => {
    expect(await main(['install', '--help'])).toBe(0)
    expect(getHelpOutput()).not.toContain('--no-input')

    infoSpy.mockClear()
    logSpy.mockClear()

    expect(await main(['hooks', '--help'])).toBe(0)
    expect(getHelpOutput()).not.toContain('--scope')
    expect(getHelpOutput()).not.toContain('--agents')
  })

  it('does nothing without local delivery configuration', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-sync-unconfigured-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    process.chdir(root)

    const exitCode = await main(['sync'])

    expect(exitCode).toBe(0)
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith(
      'Intent skill delivery is not configured for this checkout. Run `intent install` to configure it.',
    )
    expect(readdirSync(root)).toEqual(['package.json'])
  })

  it('syncs verified links and reports changed, pending, removed, and dry-run work', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-sync-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        skills: ['verified'],
      },
    })
    writeInstalledIntentPackage(root, {
      name: 'verified',
      version: '1.0.0',
      skillName: 'core',
      description: 'Verified skill',
    })
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    writeIntentDeliveryConfig(root, {
      method: 'symlink',
      targets: ['github', 'vscode'],
    })
    process.chdir(root)
    const discovered = scanForIntents(root, { scope: 'local' }).packages
    writeIntentLock(root, discovered)

    expect(await main(['sync'])).toBe(0)
    const linkPath = join(root, '.github', 'skills', 'npm-verified-core')
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    const state = readFileSync(
      join(root, '.intent', 'install-state.json'),
      'utf8',
    )
    const excludePath = resolve(
      root,
      execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    )
    const localExclude = readFileSync(excludePath, 'utf8')
    expect(localExclude).toContain('.github/skills/npm-verified-core')
    expect(localExclude).not.toContain('.intent/')
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.intent/')
    expect(await main(['sync'])).toBe(0)
    expect(
      readFileSync(join(root, '.intent', 'install-state.json'), 'utf8'),
    ).toBe(state)

    writeSkillMd(
      join(root, 'node_modules', 'verified', 'skills', 'additional'),
      {
        name: 'additional',
        description: 'Additional skill',
      },
    )
    expect(await main(['sync'])).toBe(0)
    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      [
        'New skills found in enabled dependencies:',
        '',
        'verified  1 skill',
        '',
        'Run `intent install` to review and install them.',
      ].join('\n'),
    )

    writeFileSync(
      join(root, 'node_modules', 'verified', 'skills', 'core', 'SKILL.md'),
      '---\nname: core\ndescription: changed\n---\n',
    )
    expect(await main(['sync'])).toBe(0)
    expect(existsSync(linkPath)).toBe(false)
    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      [
        'Changed skill content:',
        '',
        'verified  1 skill',
        '',
        'Run `intent install` to review and accept the new baseline.',
      ].join('\n'),
    )
    expect(
      JSON.parse(
        readFileSync(join(root, '.intent', 'install-state.json'), 'utf8'),
      ),
    ).toEqual({ version: 1, entries: [] })

    writeInstalledIntentPackage(root, {
      name: 'pending',
      version: '1.0.0',
      skillName: 'new',
      description: 'Pending skill',
    })
    expect(await main(['sync'])).toBe(0)
    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      [
        'Pending skills by source:',
        '',
        'pending  1 skill',
        '',
        'Run `intent install` to review and install them, or add them to `intent.exclude`.',
      ].join('\n'),
    )

    rmSync(join(root, 'node_modules', 'verified'), {
      recursive: true,
      force: true,
    })
    expect(await main(['sync'])).toBe(0)
    expect(existsSync(linkPath)).toBe(false)

    const dryRoot = mkdtempSync(join(realTmpdir, 'intent-cli-sync-dry-run-'))
    tempDirs.push(dryRoot)
    writeJson(join(dryRoot, 'package.json'), {
      name: 'dry-app',
      private: true,
      intent: {
        skills: ['dry-package'],
      },
    })
    writeInstalledIntentPackage(dryRoot, {
      name: 'dry-package',
      version: '1.0.0',
      skillName: 'core',
      description: 'Dry skill',
    })
    writeIntentDeliveryConfig(dryRoot, {
      method: 'symlink',
      targets: ['agents'],
    })
    const dryDiscovered = scanForIntents(dryRoot, { scope: 'local' }).packages
    writeIntentLock(dryRoot, dryDiscovered)
    process.chdir(dryRoot)
    expect(await main(['sync', '--dry-run', '--json'])).toBe(0)
    expect(
      existsSync(join(dryRoot, '.agents', 'skills', 'npm-dry-package-core')),
    ).toBe(false)
    expect(existsSync(join(dryRoot, '.intent', 'install-state.json'))).toBe(
      false,
    )
  })

  it('reports sync preflight conflicts before failing without writing', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-sync-conflict-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        skills: ['verified#core'],
      },
    })
    writeInstalledIntentPackage(root, {
      name: 'verified',
      version: '1.0.0',
      skillName: 'core',
      description: 'Verified skill',
    })
    writeIntentDeliveryConfig(root, {
      method: 'symlink',
      targets: ['agents'],
    })
    process.chdir(root)

    const discovered = scanForIntents(root, { scope: 'local' }).packages
    writeIntentLock(root, discovered)
    expect(await main(['sync'])).toBe(0)
    const statePath = join(root, '.intent', 'install-state.json')
    const conflictPath = '.agents/skills/npm-verified-core'
    const linkPath = join(root, conflictPath)
    rmSync(statePath)
    logSpy.mockClear()

    expect(await main(['sync', '--json'])).toBe(1)

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      created: [],
      repaired: [],
      removed: [],
      conflicts: [conflictPath],
    })
    expect(existsSync(statePath)).toBe(false)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)

    logSpy.mockClear()

    expect(await main(['sync'])).toBe(1)

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Intent sync: 0 created, 0 repaired, 0 removed.')
    expect(output).toContain(`Conflicts: ${conflictPath}.`)
    expect(existsSync(statePath)).toBe(false)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })

  it('rejects the removed install --print-prompt option', async () => {
    const exitCode = await main(['install', '--print-prompt'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Unknown option `--printPrompt`')
  })

  it('rejects the removed install --no-input option before writing files', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-flags-'))
    tempDirs.push(root)
    const entriesBefore = readdirSync(root)
    process.chdir(root)

    expect(await main(['install', '--no-input'])).toBe(1)

    expect(errorSpy).toHaveBeenCalledWith('Unknown option `--input`')
    expect(readdirSync(root)).toEqual(entriesBefore)
  })

  it('lists excludes when none are configured', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-exclude-list-empty-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
    })
    process.chdir(root)

    const exitCode = await main(['exclude'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith('No excludes configured.')
  })

  it.each([{ command: ['list'] }, { command: ['add', 'new-pkg'] }])(
    'keeps exclude mutations strict for released config ($command)',
    async ({ command }) => {
      const root = mkdtempSync(
        join(realTmpdir, 'intent-cli-exclude-write-legacy-'),
      )
      tempDirs.push(root)
      writeJson(join(root, 'package.json'), {
        name: 'app',
        private: true,
        intent: { skills: null, exclude: ['legacy-pkg'] },
      })
      const packageJsonBefore = readFileSync(join(root, 'package.json'), 'utf8')
      process.chdir(root)

      expect(await main(['exclude', ...command])).toBe(1)

      expect(errorSpy).toHaveBeenCalledWith(
        'Invalid package.json intent configuration: intent.skills must be an array of strings.',
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
        packageJsonBefore,
      )
    },
  )

  it('adds and lists an exclude pattern', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-exclude-add-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
    })
    process.chdir(root)

    const addExitCode = await main([
      'exclude',
      'add',
      '@tanstack/router#experimental-*',
    ])
    const listExitCode = await main(['exclude'])
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      intent?: { exclude?: Array<string> }
    }
    const output = logSpy.mock.calls.flat().join('\n')

    expect(addExitCode).toBe(0)
    expect(listExitCode).toBe(0)
    expect(pkg.intent?.exclude).toEqual(['@tanstack/router#experimental-*'])
    expect(output).toContain('Configured excludes:')
    expect(output).toContain('- @tanstack/router#experimental-*')
  })

  it('removes an exclude pattern', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-exclude-remove-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        exclude: ['@tanstack/router#experimental-*'],
      },
    })
    process.chdir(root)

    const exitCode = await main([
      'exclude',
      'remove',
      '@tanstack/router#experimental-*',
    ])
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      intent?: { exclude?: Array<string> }
    }

    expect(exitCode).toBe(0)
    expect(pkg.intent?.exclude).toEqual([])
    expect(logSpy).toHaveBeenCalledWith(
      'Removed exclude pattern "@tanstack/router#experimental-*" from package.json intent.exclude.',
    )
  })

  it('prints excludes as JSON', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-exclude-list-json-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        exclude: ['@tanstack/router#experimental-*', '*#draft-*'],
      },
    })
    process.chdir(root)

    const exitCode = await main(['exclude', 'list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as Array<string>

    expect(exitCode).toBe(0)
    expect(parsed).toEqual(['@tanstack/router#experimental-*', '*#draft-*'])
  })

  it('fails cleanly on unknown exclude actions', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-exclude-bad-action-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
    })
    process.chdir(root)

    const exitCode = await main(['exclude', 'enable', '@tanstack/router'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Unknown exclude action: enable. Expected list, add, or remove.',
    )
  })

  it.each([{ flags: [] }, { flags: ['--dry-run'] }])(
    'fails without writing when interactive install runs outside a TTY ($flags)',
    async ({ flags }) => {
      const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-nontty-'))
      tempDirs.push(root)
      writeJson(join(root, 'package.json'), { name: 'app', private: true })
      process.chdir(root)

      const exitCode = await main(['install', ...flags])

      expect(exitCode).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(
        'Interactive installation requires a terminal. Run `intent install` in a TTY or use `intent install --map`.',
      )
      expect(existsSync(join(root, 'intent.lock'))).toBe(false)
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    },
  )

  it('rejects the removed hooks install action', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-hooks-install-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['hooks', 'install'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Unknown hooks action: expected run.')
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('runs the session catalogue hook for a valid agent', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-hooks-run-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['hooks', 'run', '--agent', 'claude'])

    expect(exitCode).toBe(0)
  })

  it('requires an agent for hooks run', async () => {
    const exitCode = await main(['hooks', 'run'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Missing hook agent. Expected copilot, claude, or codex.',
    )
  })

  it('fails cleanly for an invalid hooks run agent', async () => {
    const exitCode = await main(['hooks', 'run', '--agent', 'cursor'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Unknown hook agent: cursor. Expected copilot, claude, or codex.',
    )
  })

  it('writes install catalog guidance with --map and is idempotent', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-map-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-map-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['install', '--map'])
    const agentsPath = join(root, 'AGENTS.md')
    const content = readFileSync(agentsPath, 'utf8')
    const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Created AGENTS.md with skill loading guidance.')
    expect(output).toContain(
      'The Intent guidance checks for a session catalog before loading matching skills.',
    )
    expect(content).toContain(
      `npx @tanstack/intent@${intentPackagePin} catalog`,
    )
    expect(content).toContain(
      `npx @tanstack/intent@${intentPackagePin} load <package>#<skill>`,
    )
    expect(content).not.toContain('@tanstack/query#fetching')
    expect(content).not.toContain('snapshot')
    expect(content).not.toContain(root)

    logSpy.mockClear()

    const secondExitCode = await main(['install', '--map'])
    const secondOutput = logSpy.mock.calls.flat().join('\n')

    expect(secondExitCode).toBe(0)
    expect(secondOutput).toContain(
      'No changes to AGENTS.md; skill loading guidance already current.',
    )
    expect(readFileSync(agentsPath, 'utf8')).toBe(content)
  })

  it('omits unlisted packages from the install --map block', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-allowlist-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-allowlist-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/unlisted',
      version: '1.0.0',
      skillName: 'panel',
      description: 'Unlisted panel skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map'])
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8')

    expect(exitCode).toBe(0)
    expect(content).toContain('catalog')
    expect(content).not.toContain('@tanstack/query#fetching')
    expect(content).not.toContain('@tanstack/unlisted')
  })

  it('ignores configured global packages during install --map by default', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-local-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-local-only-global-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map', '--dry-run'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('No intent-enabled skills found.')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('rejects --global during install', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-install-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map', '--global', '--dry-run'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain(
      '`intent install` does not support --global or --global-only. Global catalog support is not available.',
    )
  })

  it('rejects --global-only during install', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-global-only-'),
    )
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-install-global-only-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    writeInstalledIntentPackage(root, {
      name: '@tanstack/local',
      version: '1.0.0',
      skillName: 'local-skill',
      description: 'Local skill',
    })
    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['install', '--map', '--global-only'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain(
      '`intent install` does not support --global or --global-only. Global catalog support is not available.',
    )
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('prints the scaffold prompt', async () => {
    const exitCode = await main(['scaffold'])
    const output = String(logSpy.mock.calls[0]?.[0])

    expect(exitCode).toBe(0)
    expect(output).toContain('## Step 1')
    expect(output).toContain(join('meta', 'domain-discovery', 'SKILL.md'))
  })

  it('updates package.json for skill publishing', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-edit-package-json-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
    })

    process.chdir(root)

    const exitCode = await main(['edit-package-json'])
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      keywords?: Array<string>
      files?: Array<string>
    }
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(pkg.keywords).toContain('tanstack-intent')
    expect(pkg.files).toContain('skills')
    expect(pkg.files).toContain('!skills/_artifacts')
    expect(output).toContain('Added keywords: "tanstack-intent"')
  })

  it('copies github workflow templates', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-setup-gha-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@scope/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'scope/pkg', docs: 'docs/' },
    })

    process.chdir(root)

    const exitCode = await main(['setup-github-actions'])
    const workflowsDir = join(root, '.github', 'workflows')
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(existsSync(workflowsDir)).toBe(true)
    expect(output).toContain('Copied workflow:')
    expect(output).toContain('Template variables applied:')
  })

  it('copies github workflow templates with the setup alias', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-setup-alias-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@scope/pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'scope/pkg', docs: 'docs/' },
    })

    process.chdir(root)

    const exitCode = await main(['setup'])
    const workflowsDir = join(root, '.github', 'workflows')
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(existsSync(workflowsDir)).toBe(true)
    expect(output).toContain('Copied workflow:')
    expect(output).toContain('Template variables applied:')
  })

  it('copies github workflow templates to the workspace root', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-setup-gha-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
      intent: { version: 1, repo: 'TanStack/router', docs: 'docs/' },
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
    })

    process.chdir(join(root, 'packages', 'router'))

    const exitCode = await main(['setup-github-actions'])
    const rootWorkflowsDir = join(root, '.github', 'workflows')
    const packageWorkflowsDir = join(
      root,
      'packages',
      'router',
      '.github',
      'workflows',
    )
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(existsSync(rootWorkflowsDir)).toBe(true)
    expect(existsSync(packageWorkflowsDir)).toBe(false)
    expect(output).toContain('Mode:     monorepo')
  })

  it('lists installed intent packages as json', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'db')

    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/db'] },
    })
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        version: string
        source: 'local' | 'global'
        skillCount: number
      }>
      skills: Array<{ use: string; packageName: string; skillName: string }>
      conflicts: Array<{ packageName: string }>
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/db',
      version: '0.5.2',
      source: 'local',
      skillCount: 1,
    })
    expect(parsed.skills).toEqual([
      expect.objectContaining({
        use: '@tanstack/db#db-core',
        packageName: '@tanstack/db',
        skillName: 'db-core',
      }),
    ])
    expect(parsed.conflicts).toEqual([])
    expect(parsed.warnings).toEqual([])
  })

  it('prints the empty default list message', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-empty-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: [] },
    })
    process.chdir(root)

    const exitCode = await main(['list'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('No intent-enabled packages found.')
  })

  it('prints full load commands for every skill in human list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-load-commands-'))
    tempDirs.push(root)
    writeAllowAllConsumer(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')

    writeFileSync(join(root, 'pnpm-lock.yaml'), '')

    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query fetching skill',
    })
    writeSkillMd(join(pkgDir, 'skills', 'query', 'cache'), {
      name: 'query/cache',
      description: 'Query cache skill',
    })

    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list'])
    const output = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('PACKAGE')
    expect(output).toContain('SOURCE')
    expect(output).toContain('VERSION')
    expect(output).toContain('SKILLS')
    expect(stderr).toContain('Notices:')
    expect(output).toContain(
      `Load: pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching`,
    )
    expect(output).toContain(
      `Load: pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#query/cache`,
    )
    expect(output.match(/Load:/g)).toHaveLength(2)
  })

  it('explains why human-listed skills are available', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-why-'))
    tempDirs.push(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')
    const excludePattern = '@tanstack/query#mutations'

    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        skills: [
          '@tanstack/query#fetching',
          '@tanstack/query#query/cache',
          excludePattern,
        ],
        exclude: [excludePattern],
      },
    })
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query fetching skill',
    })
    writeSkillMd(join(pkgDir, 'skills', 'query', 'cache'), {
      name: 'query/cache',
      description: 'Query cache skill',
    })
    writeSkillMd(join(pkgDir, 'skills', 'mutations'), {
      name: 'mutations',
      description: 'Query mutations skill',
    })

    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list', '--why'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      'Allowed by intent.skills["@tanstack/query#fetching"]',
    )
    expect(output).toContain(
      'Allowed by intent.skills["@tanstack/query#query/cache"]',
    )
    expect(output.indexOf('Allowed by')).toBeLessThan(output.indexOf('Load:'))

    logSpy.mockClear()
    const jsonExitCode = await main(['list', '--json', '--why'])
    const jsonOutput = logSpy.mock.calls.flat().join('\n')
    const parsed = JSON.parse(jsonOutput) as {
      skills: Array<{ use: string; why?: string }>
      excludedSkills: Array<{
        use: string
        why?: string
        excluded: true
      }>
    }

    expect(jsonExitCode).toBe(0)
    expect(
      Object.fromEntries(parsed.skills.map(({ use, why }) => [use, why])),
    ).toMatchObject({
      '@tanstack/query#fetching':
        'Allowed by intent.skills["@tanstack/query#fetching"]',
      '@tanstack/query#query/cache':
        'Allowed by intent.skills["@tanstack/query#query/cache"]',
    })
    expect(parsed.excludedSkills).toContainEqual(
      expect.objectContaining({
        use: excludePattern,
        excluded: true,
        why: `Excluded by intent.exclude[${JSON.stringify(excludePattern)}]`,
      }),
    )
  })

  it.each(['@tanstack/query#fetching', '@tanstack/query'])(
    'explains skills excluded by %s only under --why',
    async (pattern) => {
      const root = mkdtempSync(
        join(realTmpdir, 'intent-cli-list-why-excluded-'),
      )
      tempDirs.push(root)
      writeJson(join(root, 'package.json'), {
        name: 'app',
        private: true,
        intent: {
          skills: ['@tanstack/query'],
          exclude: [pattern],
        },
      })
      writeInstalledIntentPackage(root, {
        name: '@tanstack/query',
        version: '5.0.0',
        skillName: 'fetching',
        description: 'Query data fetching patterns',
      })
      process.env.INTENT_AUDIENCE = 'human'
      process.chdir(root)

      expect(await main(['list'])).toBe(0)
      const defaultOutput = logSpy.mock.calls.flat().join('\n')
      expect(defaultOutput).not.toContain('@tanstack/query\n')
      expect(defaultOutput).not.toContain('fetching')
      logSpy.mockClear()

      expect(await main(['list', '--why'])).toBe(0)
      const whyOutput = logSpy.mock.calls.flat().join('\n')
      expect(whyOutput).toContain('@tanstack/query\n')
      expect(whyOutput).toContain('fetching  (excluded)')
      expect(whyOutput).toContain(
        `Excluded by intent.exclude[${JSON.stringify(pattern)}]`,
      )
      expect(whyOutput).not.toContain('Load:')
    },
  )

  it('names a package-level entry that allows a skill', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-why-package-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    expect(await main(['list', '--why'])).toBe(0)
    const output = logSpy.mock.calls.flat().join('\n')

    expect(output).toContain('Allowed by intent.skills["@tanstack/query"]')
  })

  it('explains explicit allow-all configuration', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-why-mode-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['*'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    expect(await main(['list', '--why'])).toBe(0)
    const output = logSpy.mock.calls.flat().join('\n')

    expect(output).toContain('Allowed because intent.skills allows all sources')
  })

  it('adds no output for --why in agent sessions', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-why-agent-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: {
        skills: ['@tanstack/query'],
        exclude: ['@tanstack/query#fetching'],
      },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    expect(await main(['list'])).toBe(0)
    const defaultOutput = logSpy.mock.calls
      .map((call: Array<unknown>) => call[0])
      .join('\n')
    logSpy.mockClear()

    expect(await main(['list', '--why'])).toBe(0)
    const whyOutput = logSpy.mock.calls
      .map((call: Array<unknown>) => call[0])
      .join('\n')

    expect(whyOutput).toBe(defaultOutput)
  })

  it.each([false, true])(
    'does not reveal policy-concealed skills under --why %#',
    async (showHidden) => {
      const root = mkdtempSync(
        join(realTmpdir, 'intent-cli-list-why-concealed-'),
      )
      tempDirs.push(root)
      writeJson(join(root, 'package.json'), {
        name: 'app',
        private: true,
        intent: {
          skills: ['@tanstack/query'],
          exclude: ['@tanstack/router#routing'],
        },
      })
      writeInstalledIntentPackage(root, {
        name: '@tanstack/query',
        version: '5.0.0',
        skillName: 'fetching',
        description: 'Query data fetching patterns',
      })
      writeInstalledIntentPackage(root, {
        name: '@tanstack/router',
        version: '1.0.0',
        skillName: 'routing',
        description: 'Router navigation patterns',
      })
      process.env.INTENT_AUDIENCE = 'human'
      process.chdir(root)

      expect(
        await main(['list', '--why', ...(showHidden ? ['--show-hidden'] : [])]),
      ).toBe(0)
      const combinedOutput = [
        ...logSpy.mock.calls.flat(),
        ...errorSpy.mock.calls.flat(),
      ].join('\n')

      expect(combinedOutput).not.toContain('routing')
      expect(combinedOutput).not.toContain(
        'intent.exclude["@tanstack/router#routing"]',
      )
    },
  )

  it('prints compact list guidance for agents', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-agent-'))
    tempDirs.push(root)
    writeAllowAllConsumer(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')

    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query fetching skill',
    })
    writeSkillMd(join(pkgDir, 'skills', 'query', 'cache'), {
      name: 'query/cache',
      description: 'Query cache skill',
    })

    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    const exitCode = await main(['list'])
    const output = logSpy.mock.calls
      .map((call: Array<unknown>) => `${String(call[0] ?? '')}\n`)
      .join('')
    const stderr = errorSpy.mock.calls.flat().join('\n')
    const loadHeader = `Load a skill with \`pnpm dlx @tanstack/intent@${intentPackagePin} load <id>\`.`

    expect(exitCode).toBe(0)
    expect(output).not.toContain('PACKAGE')
    expect(output).not.toContain('SOURCE')
    expect(output).not.toContain('VERSION')
    expect(output).not.toContain('SKILLS')
    expect(stderr).not.toContain('Notices:')
    expect(stderr).not.toContain('intent.skills is not set')
    expect(output.split(loadHeader)).toHaveLength(2)
    expect(output).toContain(
      `1 intent-enabled packages, 2 skills\n\n${loadHeader}`,
    )
    expect(output).not.toContain(
      `1 intent-enabled packages, 2 skills\n\n\n${loadHeader}`,
    )
    expect(output).not.toContain('Load:')
    expect(output).toContain('fetching')
    expect(output).toContain('query/cache')
  })

  it('reveals hidden skill sources for human list output when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-hidden-human-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: 'get-tsconfig',
      version: '4.0.0',
      skillName: 'config',
      description: 'TypeScript config lookup',
    })
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list', '--show-hidden'])
    const output = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Hidden skill sources:')
    expect(output).toContain('get-tsconfig')
    expect(output).toContain('1 skill')
    expect(stderr).toContain('get-tsconfig')
    expect(stderr).toContain('Add to opt in')
  })

  it('explains already-visible hidden sources without revealing more', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-hidden-why-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: 'get-tsconfig',
      version: '4.0.0',
      skillName: 'config',
      description: 'TypeScript config lookup',
    })
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    expect(await main(['list', '--show-hidden', '--why'])).toBe(0)
    const output = logSpy.mock.calls.flat().join('\n')

    expect(output).toContain('  get-tsconfig (1 skill)')
    expect(output).toContain('    Hidden because not listed in intent.skills')
    expect(output.match(/get-tsconfig/g)).toHaveLength(1)
  })

  it('does not reveal hidden skill sources to agent list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-hidden-agent-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: 'get-tsconfig',
      version: '4.0.0',
      skillName: 'config',
      description: 'TypeScript config lookup',
    })
    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    const exitCode = await main(['list', '--show-hidden'])
    const output = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')
    const combined = `${output}\n${stderr}`

    expect(exitCode).toBe(0)
    expect(combined).toContain(
      'Hidden skill sources are not revealed in agent sessions. Run this command outside the agent session to review candidates.',
    )
    expect(combined).not.toContain(
      '1 discovered skill source with 1 skill is hidden',
    )
    expect(combined).not.toContain('get-tsconfig')
    expect(combined).not.toContain('Add to opt in')
  })

  it('does not reveal hidden skill sources in agent JSON output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-hidden-json-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: 'get-tsconfig',
      version: '4.0.0',
      skillName: 'config',
      description: 'TypeScript config lookup',
    })
    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
    const parsed = JSON.parse(output) as {
      hiddenSourceCount: number
      hiddenSources: Array<unknown>
      notices: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed.hiddenSourceCount).toBe(1)
    expect(parsed.hiddenSources).toEqual([])
    expect(parsed.notices).toEqual([
      '1 discovered skill source with 1 skill is hidden because it is not listed in intent.skills. Ask the user to run `intent list --show-hidden` outside the agent session to review candidates.',
    ])
    expect(output).not.toContain('get-tsconfig')
    expect(output).not.toContain('Add to opt in')
  })

  it.each([
    ['pnpm-lock.yaml', `pnpm dlx @tanstack/intent@${intentPackagePin}`],
    ['yarn.lock', `yarn dlx @tanstack/intent@${intentPackagePin}`],
    ['bun.lock', `bunx @tanstack/intent@${intentPackagePin}`],
  ])(
    'prints %s load commands for human list output',
    async (lockfile, runner) => {
      const root = mkdtempSync(
        join(realTmpdir, 'intent-cli-list-package-runner-'),
      )
      tempDirs.push(root)
      writeFileSync(join(root, lockfile), '')
      writeInstalledIntentPackage(root, {
        name: '@tanstack/query',
        version: '5.0.0',
        skillName: 'fetching',
        description: 'Query fetching skill',
      })

      process.env.INTENT_AUDIENCE = 'human'
      process.chdir(root)

      const exitCode = await main(['list'])
      const output = logSpy.mock.calls.flat().join('\n')

      expect(exitCode).toBe(0)
      expect(output).toContain(`Load: ${runner} load @tanstack/query#fetching`)
    },
  )

  it('does not print warning noise for normal pnpm list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-pnpm-clean-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
      dependencies: {
        wrapper: '1.0.0',
      },
    })

    const wrapperDir = join(root, 'node_modules', 'wrapper')
    writeJson(join(wrapperDir, 'package.json'), {
      name: 'wrapper',
      version: '1.0.0',
      dependencies: {
        '@tanstack/query': '5.0.0',
      },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query fetching skill',
    })

    process.chdir(root)

    const exitCode = await main(['list'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('@tanstack/query')
    expect(output).not.toContain('Warnings:')
    expect(output).not.toContain('Could not read')
  })

  it('treats missing intent.skills as empty without a migration notice', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-migration-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-migration-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeJson(join(root, 'package.json'), { name: 'app', private: true })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list'])
    const stdout = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(stdout).toContain('No intent-enabled packages found.')
    expect(stderr).toContain('intent.skills is empty')
    expect(stderr).not.toContain('intent.skills is not set')
    expect(stdout).not.toContain('intent.skills is not set')
    expect(stdout).not.toContain('Notices:')
  })

  it('suppresses notices when --no-notices is passed', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-no-notices-'))
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-no-notices-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--no-notices'])
    const stdout = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(stdout).toContain('@tanstack/query')
    expect(stderr).not.toContain('intent.skills is not set')
    expect(stderr).not.toContain('Notices:')
  })

  it('does not suppress the allow-all risk banner under --no-notices', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-allow-all-no-notices-'),
    )
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-allow-all-no-notices-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeJson(join(root, 'package.json'), {
      name: 'consumer',
      intent: { skills: ['*'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list', '--no-notices'])
    const stdout = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(stdout).toContain('@tanstack/query')
    expect(stderr).toContain('Notices:')
    expect(stderr).toContain('All skill sources allowed')
  })

  it('suppresses notices when INTENT_NO_NOTICES=1 is set', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-env-no-notices-'),
    )
    const isolatedGlobalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-env-no-notices-empty-global-'),
    )
    tempDirs.push(root, isolatedGlobalRoot)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = isolatedGlobalRoot
    process.env.INTENT_NO_NOTICES = '1'
    process.chdir(root)

    const exitCode = await main(['list'])
    const stdout = logSpy.mock.calls.flat().join('\n')
    const stderr = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(stdout).toContain('@tanstack/query')
    expect(stderr).not.toContain('intent.skills is not set')
    expect(stderr).not.toContain('Notices:')
  })

  it('prints list debug details to stderr without changing json stdout', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-debug-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    process.chdir(root)

    const exitCode = await main(['list', '--json', '--debug'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      debug?: unknown
      packages: Array<{ name: string }>
    }
    const debugOutput = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(parsed.debug).toBeUndefined()
    expect(parsed.packages.map((pkg) => pkg.name)).toEqual(['@tanstack/query'])
    expect(debugOutput).toContain('Debug: intent list')
    expect(debugOutput).toContain(`cwd: ${root}`)
    expect(debugOutput).toContain('scope: local')
    expect(debugOutput).toContain('packages: 1')
    expect(debugOutput).toContain('skills: 1')
    expect(debugOutput).toContain('packageJsonReadCount:')
    expect(debugOutput).toContain('packageJsonCacheHits:')
  })

  it('ignores configured global intent packages in list json output by default', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-local-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-local-only-global-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{ name: string }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toEqual([])
  })

  it('includes configured global intent packages in list json output when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        version: string
        source: 'local' | 'global'
        skillCount: number
      }>
      skills: Array<{
        packageName: string
        packageSource: 'local' | 'global'
        packageVersion: string
        skillName: string
        use: string
      }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/query',
      version: '5.0.0',
      source: 'global',
      skillCount: 1,
    })
    expect(parsed.skills[0]).toMatchObject({
      packageName: '@tanstack/query',
      packageSource: 'global',
      packageVersion: '5.0.0',
      skillName: 'fetching',
      use: '@tanstack/query#fetching',
    })
  })

  it('does not print absolute global skill paths in global list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-global-human-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-global-human-node-modules-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list', '--global'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Global fetching skill')
    expect(output).toContain(
      `Load: npx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching --global`,
    )
    expect(output).not.toContain(globalPkgDir)
  })

  it('prefers local over global in list json output when both exist', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-mixed-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-mixed-global-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const localPkgDir = join(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(localPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.1.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(localPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Local fetching skill',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        version: string
        source: 'local' | 'global'
      }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/query',
      version: '5.1.0',
      source: 'local',
    })
  })

  it('lists global-only packages without local packages when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-global-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-list-global-only-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.1.0',
      skillName: 'fetching',
      description: 'Local fetching skill',
    })
    writeFileSync(join(root, '.pnp.cjs'), 'module.exports = {}\n')

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['list', '--global-only', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{
        name: string
        source: 'local' | 'global'
        version: string
        skillCount: number
      }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/query',
      source: 'global',
      version: '4.0.0',
      skillCount: 1,
    })
  })

  it('excludes packages from list output with package.json intent.exclude', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-list-exclude-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { exclude: ['@tanstack/*devtools*'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/devtools',
      version: '1.0.0',
      skillName: 'panel',
      description: 'Devtools panel skill',
    })

    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{ name: string }>
      skills: Array<{ use: string }>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages.map((pkg) => pkg.name)).toEqual(['@tanstack/query'])
    expect(parsed.skills.map((skill) => skill.use)).toEqual([
      '@tanstack/query#fetching',
    ])
  })

  it.each([['list'], ['install'], ['load', '@tanstack/query#core']])(
    'rejects --global and --global-only together on %s',
    async (...command) => {
      const root = mkdtempSync(join(realTmpdir, 'intent-cli-mutual-excl-'))
      tempDirs.push(root)
      process.chdir(root)

      const exitCode = await main([...command, '--global', '--global-only'])

      expect(exitCode).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(
        command[0] === 'install'
          ? '`intent install` does not support --global or --global-only. Global catalog support is not available.'
          : 'Use either --global or --global-only, not both.',
      )
    },
  )

  it('loads a local skill use as markdown', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching'])
    const output = stdoutWriteSpy.mock.calls.flat().join('')

    expect(exitCode).toBe(0)
    expect(output).toContain('Skill content here.')
  })

  it('rewrites relative markdown destinations when loading a skill', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-links-'))
    tempDirs.push(root)
    writeAllowAllConsumer(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')
    const skillDir = join(pkgDir, 'skills', 'fetching')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: fetching',
        'description: Query data fetching patterns',
        '---',
        '',
        '- [Reference](references/topic.md)',
        '- ![Diagram](assets/diagram.png)',
        '- [Parent](../shared.md#setup)',
        '- [External](https://example.com/reference.md)',
        '- [Mail](mailto:test@example.com)',
        '- [Anchor](#setup)',
        '- [Absolute](/tmp/reference.md)',
        '- [Escapes](../../../outside.md)',
        '- `inline [Code](references/code.md)`',
        '```md',
        '[Fenced](references/fenced.md)',
        '```',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching'])
    const output = stdoutWriteSpy.mock.calls.flat().join('')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      '[Reference](node_modules/@tanstack/query/skills/fetching/references/topic.md)',
    )
    expect(output).toContain(
      '![Diagram](node_modules/@tanstack/query/skills/fetching/assets/diagram.png)',
    )
    expect(output).toContain(
      '[Parent](node_modules/@tanstack/query/skills/shared.md#setup)',
    )
    expect(output).toContain('[External](https://example.com/reference.md)')
    expect(output).toContain('[Mail](mailto:test@example.com)')
    expect(output).toContain('[Anchor](#setup)')
    expect(output).toContain('[Absolute](/tmp/reference.md)')
    expect(output).toContain('[Escapes](../../../outside.md)')
    expect(output).toContain('`inline [Code](references/code.md)`')
    expect(output).toContain('[Fenced](references/fenced.md)')
  })

  it('loads a local skill use to a path with --path', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-path-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching', '--path'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe('node_modules/@tanstack/query/skills/fetching/SKILL.md')
  })

  it('prints a skill path without reading skill content', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-path-only-'))
    tempDirs.push(root)
    writeAllowAllConsumer(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching', '--path'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe('node_modules/@tanstack/query/skills/fetching/SKILL.md')
  })

  it('prints load debug details to stderr without changing path stdout', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-debug-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main([
      'load',
      '@tanstack/query#fetching',
      '--path',
      '--debug',
    ])
    const output = logSpy.mock.calls.flat().join('\n')
    const debugOutput = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe('node_modules/@tanstack/query/skills/fetching/SKILL.md')
    expect(debugOutput).toContain('Debug: intent load')
    expect(debugOutput).toContain(`cwd: ${root}`)
    expect(debugOutput).toContain('scope: local')
    expect(debugOutput).toContain('resolution: fast-path')
    expect(debugOutput).toContain('package: @tanstack/query')
    expect(debugOutput).toContain('skill: fetching')
    expect(debugOutput).toContain('packageJsonReadCount:')
    expect(debugOutput).toContain('packageJsonCacheHits:')
  })

  it('loads a skill use as json', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-json-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      package: string
      content: string
      path: string
      packageRoot: string
      skill: string
      source: 'local' | 'global'
      version: string
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed).toEqual({
      package: '@tanstack/query',
      content: expect.stringContaining('Skill content here.'),
      path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
      packageRoot: join(root, 'node_modules', '@tanstack', 'query'),
      skill: 'fetching',
      source: 'local',
      version: '5.0.0',
      warnings: [],
    })
  })

  it('rewrites relative markdown destinations in json load content', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-json-links-'))
    tempDirs.push(root)
    writeAllowAllConsumer(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')
    const skillDir = join(pkgDir, 'skills', 'fetching')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: fetching',
        'description: Query data fetching patterns',
        '---',
        '',
        '[Reference](references/topic.md)',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as { content: string }

    expect(exitCode).toBe(0)
    expect(parsed.content).toContain(
      '[Reference](node_modules/@tanstack/query/skills/fetching/references/topic.md)',
    )
  })

  it('loads global fallback path when requested', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-load-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)
    writeAllowAllConsumer(root)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main([
      'load',
      '@tanstack/query#fetching',
      '--global',
      '--path',
    ])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toBe(join(globalPkgDir, 'skills', 'fetching', 'SKILL.md'))
  })

  it('loads global-only without using local packages', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-global-only-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-load-global-only-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.1.0',
      skillName: 'fetching',
      description: 'Local fetching skill',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '4.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main([
      'load',
      '@tanstack/query#fetching',
      '--global-only',
      '--json',
    ])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      path: string
      source: 'local' | 'global'
      version: string
    }

    expect(exitCode).toBe(0)
    expect(parsed.source).toBe('global')
    expect(parsed.version).toBe('4.0.0')
    expect(parsed.path).toBe(
      join(globalPkgDir, 'skills', 'fetching', 'SKILL.md'),
    )
  })

  it('fails cleanly for invalid load use strings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-invalid-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Invalid skill use "@tanstack/query": expected <package>#<skill>.',
    )
  })

  it('fails cleanly when load cannot find the package', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-load-missing-package-'),
    )
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { skills: ['@tanstack/query'] },
    })
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#fetching'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Cannot resolve skill use "@tanstack/query#fetching": package "@tanstack/query" was not found.',
    )
  })

  it('fails cleanly when load cannot find the skill', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-missing-skill-'))
    tempDirs.push(root)
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/query#mutations'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Cannot resolve skill use "@tanstack/query#mutations": skill "mutations" was not found in package "@tanstack/query". Available skills: fetching.',
    )
  })

  it('fails clearly when loading a package excluded by package.json', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-load-exclude-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: 'app',
      private: true,
      intent: { exclude: ['@tanstack/*devtools*'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/devtools',
      version: '1.0.0',
      skillName: 'panel',
      description: 'Devtools panel skill',
    })
    process.chdir(root)

    const exitCode = await main(['load', '@tanstack/devtools#panel'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Cannot load skill use "@tanstack/devtools#panel": package "@tanstack/devtools" is excluded by Intent configuration.',
    )
  })

  it('keeps full version conflict paths in human list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-conflicts-'))
    tempDirs.push(root)
    const { queryV4Dir, queryV5Dir } = writeConflictingQueryPackages(root)

    process.env.INTENT_AUDIENCE = 'human'
    process.chdir(root)

    const exitCode = await main(['list'])
    const output = logSpy.mock.calls
      .map((call: Array<unknown>) => `${String(call[0] ?? '')}\n`)
      .join('')

    expect(exitCode).toBe(0)
    expect(output).toContain('Version conflicts:')
    expect(output).toContain('@tanstack/query -> using 5.0.0')
    expect(output).toContain(`chosen: ${queryV5Dir}`)
    expect(output).toContain(`also found: 4.0.0 at ${queryV4Dir}`)

    logSpy.mockClear()
    expect(await main(['list', '--json'])).toBe(0)
    const jsonOutput = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
    expect(jsonOutput).toContain(queryV4Dir)
    expect(jsonOutput).toContain(queryV5Dir)
  })

  it('redacts version conflict paths from agent list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-conflicts-agent-'))
    tempDirs.push(root)
    const { queryV4Dir, queryV5Dir } = writeConflictingQueryPackages(root)

    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    expect(await main(['list'])).toBe(0)
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).not.toContain('Version conflicts:')
    expect(output).not.toContain(queryV4Dir)
    expect(output).not.toContain(queryV5Dir)

    logSpy.mockClear()
    expect(await main(['list', '--json'])).toBe(0)
    const jsonOutput = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
    const parsed = JSON.parse(jsonOutput) as { conflicts: Array<unknown> }
    expect(parsed.conflicts).toEqual([])
    expect(jsonOutput).not.toContain(queryV4Dir)
    expect(jsonOutput).not.toContain(queryV5Dir)
  })

  it('redacts scanner warning paths from agent list output', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-warnings-agent-'))
    tempDirs.push(root)
    const malformedPackageDir = join(root, 'node_modules', 'malformed')
    mkdirSync(join(malformedPackageDir, 'skills'), { recursive: true })
    writeFileSync(join(malformedPackageDir, 'package.json'), '{')

    process.env.INTENT_AUDIENCE = 'agent'
    process.chdir(root)

    expect(await main(['list', '--json'])).toBe(0)
    const jsonOutput = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
    expect(jsonOutput).not.toContain(root)
  })

  it('validates a well-formed skills directory', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      '✅ Validated 1 skill files — all passed',
    )
  })

  it('warns when a catalogue description is truncated', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-catalogue-length-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@fixture/catalogue',
      devDependencies: { '@tanstack/intent': '^0.3.6' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    writeSkillMd(join(root, 'skills', 'long'), {
      name: 'long',
      description: 'a'.repeat(200),
    })
    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      'skills/long/SKILL.md: catalogue description is truncated from 200 to 180 characters (20 lost)',
    )
  })

  it('reports per-skill catalogue shaping and classification warnings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-catalogue-skills-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@fixture/catalogue',
      devDependencies: { '@tanstack/intent': '^0.3.6' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    writeSkillMd(join(root, 'skills', 'local'), {
      name: 'local',
      description: 'Read /Users/person/project/file.ts',
    })
    const unknownDir = join(root, 'skills', 'unknown')
    mkdirSync(unknownDir, { recursive: true })
    writeFileSync(
      join(unknownDir, 'SKILL.md'),
      [
        '---',
        'name: unknown',
        'description: Unknown catalogue type',
        'metadata:',
        '  type: surprising',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )
    writeSkillMd(join(root, 'skills', 'duplicate-a'), {
      name: 'duplicate-a',
      description: 'Shared description',
    })
    writeSkillMd(join(root, 'skills', 'duplicate-b'), {
      name: 'duplicate-b',
      description: 'Shared   description',
    })
    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      'skills/local/SKILL.md: catalogue description contains a local path and is blanked',
    )
    expect(output).toContain(
      'skills/unknown/SKILL.md: unknown metadata.type "surprising"; skill is included in the catalogue',
    )
    expect(output).toContain(
      'skills/duplicate-a/SKILL.md: catalogue description duplicates @fixture/catalogue#duplicate-b',
    )
    expect(output).toContain(
      'skills/duplicate-b/SKILL.md: catalogue description duplicates @fixture/catalogue#duplicate-a',
    )
  })

  it('accepts authoring types and reports catalogue exclusion for known non-task types', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-catalogue-types-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@fixture/types',
      devDependencies: { '@tanstack/intent': '^0.3.6' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    const writeTypedSkill = (name: string, type: string): void => {
      const dir = join(root, 'skills', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'SKILL.md'),
        [
          '---',
          `name: ${name}`,
          `description: Describes ${name} behaviour for agents.`,
          'metadata:',
          `  type: ${type}`,
          '---',
          '',
          'Skill content here.',
          '',
        ].join('\n'),
      )
    }
    writeTypedSkill('core-skill', 'core')
    writeTypedSkill('composition-skill', 'composition')
    writeTypedSkill('reference-skill', 'reference')
    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).not.toContain('unknown metadata.type')
    expect(output).toContain(
      'skills/reference-skill/SKILL.md: metadata.type "reference" is excluded from the catalogue; agents will not see this skill',
    )
  })

  it('warns instead of crashing when a catalogue use is malformed', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-catalogue-use-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '',
      devDependencies: { '@tanstack/intent': '^0.3.6' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    writeSkillMd(join(root, 'skills', 'core'), {
      name: 'core',
      description: 'Core concepts',
    })
    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      'skills/core/SKILL.md: malformed catalogue use: Invalid skill use "#core": package is required.',
    )
  })

  it('reports package catalogue bytes and skills outside the limits', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-catalogue-budget-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@fixture/catalogue',
      devDependencies: { '@tanstack/intent': '^0.3.6' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    for (let index = 0; index < 51; index++) {
      const skillName = `skill-${String(index).padStart(2, '0')}`
      writeSkillMd(join(root, 'skills', skillName), {
        name: skillName,
        description: `${skillName} ${'a'.repeat(160)}`,
      })
    }
    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('package.json: catalogue renders ')
    expect(output).toContain('/8000 bytes; skills outside limits:')
    expect(output).toContain('@fixture/catalogue#skill-50')
  })

  it('escalates catalogue warnings in check mode', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-catalogue-check-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), {
      name: '@fixture/catalogue',
      devDependencies: { '@tanstack/intent': '^0.3.6' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    writeSkillMd(join(root, 'skills', 'long'), {
      name: 'long',
      description: 'a'.repeat(200),
    })
    process.chdir(root)

    const exitCode = await main(['validate', '--check'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('Validation failed with 1 error(s)')
    expect(output).toContain(
      'skills/long/SKILL.md: catalogue description is truncated from 200 to 180 characters (20 lost)',
    )
  })

  it('keeps nested Intent skill names valid without Agent Skills spec warnings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-nested-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'core', 'setup'), {
      name: 'setup',
      description: 'Core setup concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('Agent Skills spec warning')
  })

  it('fails when a nested skill name carries a slash instead of a leaf segment', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-slash-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'core', 'setup'), {
      name: 'core/setup',
      description: 'Core setup concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain(
      'name "core/setup" must be a single leaf segment matching its parent directory "setup"',
    )
  })

  it('reports fixable frontmatter migrations in check mode without writing', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-check-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'core', 'setup', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    const original = [
      '---',
      'name: core/setup',
      'description: Core setup concepts',
      'type: framework',
      'library: core',
      '---',
      '',
      'Skill content here.',
      '',
    ].join('\n')
    writeFileSync(skillPath, original)

    process.chdir(root)

    const exitCode = await main(['validate', '--check'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('fixable frontmatter migration pending')
    expect(output).toContain('rewrite name to "setup"')
    expect(output).toContain('move top-level "type" under metadata.type')
    expect(readFileSync(skillPath, 'utf8')).toBe(original)
  })

  it('passes check mode when skills are already compliant', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-check-ok-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate', '--check'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
  })

  it('fixes mechanical frontmatter migrations and validates the result', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-fix-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'core', 'setup', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: core/setup',
        'description: Core setup concepts',
        'type: core',
        'library: core',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--fix'])
    const output = logSpy.mock.calls.flat().join('\n')
    const fixed = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Fixed 1 skill files')
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(fixed).toContain('name: setup')
    expect(fixed).toContain('metadata:\n  type: core\n  library: core')
    expect(fixed).not.toContain('\ntype: core')
    expect(fixed).not.toContain('\nlibrary: core')
    expect(fixed).toContain('\nSkill content here.\n')
  })

  it('keeps existing metadata values when removing conflicting top-level scalars', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-fix-conflict-'),
    )
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  library: nested',
        'library: top',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--fix'])
    const fixed = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(0)
    expect(fixed).toContain('metadata:\n  library: nested')
    expect(fixed).not.toContain('\nlibrary: top')
  })

  it('fixes names while leaving scalar migrations blocked by non-mapping metadata', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-fix-meta-block-'),
    )
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'core', 'setup', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: core/setup',
        'description: Core setup concepts',
        'metadata: nope',
        'type: core',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--fix'])
    const output = errorSpy.mock.calls.flat().join('\n')
    const fixed = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(1)
    expect(output).toContain('metadata must be a mapping')
    expect(fixed).toContain('name: setup')
    expect(fixed).toContain('type: core')
  })

  it('preserves CRLF line endings and markdown body bytes when fixing frontmatter', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-fix-crlf-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    const body = 'First body line.\r\n\r\nSecond body line.\r\n'
    writeFileSync(
      skillPath,
      [
        '---',
        'name: wrong-name',
        'description: Core database concepts',
        'type: core',
        '---',
        '',
      ].join('\r\n') + body,
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--fix'])
    const fixed = readFileSync(skillPath, 'utf8')
    const fixedBody = fixed.slice(fixed.indexOf(body))

    expect(exitCode).toBe(0)
    expect(fixed).toContain('name: db-core\r\n')
    expect(fixed).toContain('metadata:\r\n  type: core\r\n')
    expect(fixedBody).toBe(body)
  })

  it('preserves trailing comments on migrated scalar values', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-fix-comments-'),
    )
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'library: core # keep this comment',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--fix'])
    const fixed = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(0)
    expect(fixed).toContain('metadata:\n  library: core # keep this comment')
  })

  it('does not fix names when the parent directory is not a legal skill name', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-fix-invalid-parent-'),
    )
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'PDF-Processing'), {
      name: 'wrong-name',
      description: 'PDF processing concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate', '--fix'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain(
      'name "wrong-name" does not match parent directory "PDF-Processing"',
    )
  })

  it('is idempotent after fixing mechanical frontmatter migrations', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-fix-idempotent-'),
    )
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: wrong-name',
        'description: Core database concepts',
        'type: core',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const firstExitCode = await main(['validate', '--fix'])
    const fixed = readFileSync(skillPath, 'utf8')
    const secondExitCode = await main(['validate', '--fix'])

    expect(firstExitCode).toBe(0)
    expect(secondExitCode).toBe(0)
    expect(readFileSync(skillPath, 'utf8')).toBe(fixed)
  })

  it('fails cleanly when fix and check are combined', async () => {
    const exitCode = await main(['validate', '--fix', '--check'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Cannot combine --fix and --check')
  })

  it('sets metadata.library_version on a skill and re-validates', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-set-version-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  type: core',
        '  library: db',
        '  library_version: 1.0.0',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--set-version', '2.5.0'])
    const output = logSpy.mock.calls.flat().join('\n')
    const fixed = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(0)
    expect(output).toContain(
      '✅ Set library_version to "2.5.0" on 1 skill files',
    )
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(fixed).toContain('library_version: 2.5.0')
    expect(fixed).not.toContain('library_version: 1.0.0')
    expect(fixed).toContain('\nSkill content here.\n')
  })

  it('adds metadata.library_version when the key is absent', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-set-version-add-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  type: core',
        '  library: db',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--set-version', '3.0.0-beta.1'])
    const fixed = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(0)
    expect(fixed).toContain('library_version: 3.0.0-beta.1')
  })

  it('is idempotent when the version already matches', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-set-version-idem-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  library_version: 4.1.0',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const firstExitCode = await main(['validate', '--set-version', '4.1.0'])
    const afterFirst = readFileSync(skillPath, 'utf8')
    const secondExitCode = await main(['validate', '--set-version', '4.1.0'])

    expect(firstExitCode).toBe(0)
    expect(secondExitCode).toBe(0)
    expect(readFileSync(skillPath, 'utf8')).toBe(afterFirst)
  })

  it('preserves CRLF line endings and body bytes when setting version', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-set-version-crlf-'))
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    const body = 'First body line.\r\n\r\nSecond body line.\r\n'
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  library_version: 1.0.0',
        '---',
        '',
      ].join('\r\n') + body,
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--set-version', '2.0.0'])
    const fixed = readFileSync(skillPath, 'utf8')
    const fixedBody = fixed.slice(fixed.indexOf(body))

    expect(exitCode).toBe(0)
    expect(fixed).toContain('library_version: 2.0.0\r\n')
    expect(fixedBody).toBe(body)
  })

  it('fails cleanly when set-version and check are combined', async () => {
    const exitCode = await main([
      'validate',
      '--set-version',
      '2.0.0',
      '--check',
    ])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Cannot combine --set-version and --check',
    )
  })

  it('fails when set-version is passed an empty value', async () => {
    const exitCode = await main(['validate', '--set-version', '   '])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      '--set-version requires a non-empty version value',
    )
  })

  it('does not set version on a skill whose metadata is not a mapping', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-set-version-non-map-'),
    )
    tempDirs.push(root)

    const skillPath = join(root, 'skills', 'db-core', 'SKILL.md')
    mkdirSync(dirname(skillPath), { recursive: true })
    writeFileSync(
      skillPath,
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata: nope',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate', '--set-version', '2.0.0'])
    const output = errorSpy.mock.calls.flat().join('\n')
    const after = readFileSync(skillPath, 'utf8')

    expect(exitCode).toBe(1)
    expect(output).toContain('metadata must be a mapping')
    expect(after).toContain('metadata: nope')
    expect(after).not.toContain('library_version')
  })

  it('fails when a non-spec scalar field is emitted at the top level', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-scalar-'))
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'db-core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'type: core',
        'library: db',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('non-spec top-level key "type"')
    expect(output).toContain('non-spec top-level key "library"')
  })

  it('fails when metadata holds a non-string value', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-meta-'))
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'db-core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  library_version:',
        '    - 1.0.0',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('metadata values must be strings')
  })

  it('fails when metadata is not a mapping', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-meta-map-'))
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'db-core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata: just-a-string',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('metadata must be a mapping')
  })

  it('validates Agent Skills scalar frontmatter fields', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-scalars-'))
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'db-core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: 42',
        'description: []',
        'allowed-tools: "   "',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('name must be a non-empty string')
    expect(output).toContain('description must be a non-empty string')
    expect(output).toContain(
      'Agent Skills spec warning: allowed-tools should be a non-empty space-separated string',
    )
  })

  it('fails when SKILL.md frontmatter is not a mapping', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-frontmatter-'),
    )
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'db-core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      ['---', 'null', '---', '', 'Skill content here.', ''].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('YAML frontmatter must be a mapping')
  })

  it('does not flag array-valued top-level keys as non-spec scalars', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-array-key-'))
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'react-db')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: react-db',
        'description: React bindings for db',
        'metadata:',
        '  type: framework',
        'requires:',
        '  - db-core',
        'sources:',
        '  - "TanStack/db:docs/react.md"',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('non-spec top-level key')
  })

  it('fails for names with non-spec characters (uppercase)', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-spec-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'PDF-Processing'), {
      name: 'PDF-Processing',
      description: 'PDF processing concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain(
      'name "PDF-Processing" must use only lowercase letters, numbers, and hyphens',
    )
  })

  it('fails when name exceeds 64 characters', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-len-'))
    tempDirs.push(root)

    const longName = `a${'-very-long'.repeat(7)}`
    expect(longName.length).toBeGreaterThan(64)

    writeSkillMd(join(root, 'skills', longName), {
      name: longName,
      description: 'A skill with an overly long name',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain(
      `name exceeds 64 characters (${longName.length} chars)`,
    )
  })

  it('enforces framework requires when type is under metadata (new shape)', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-fw-meta-'))
    tempDirs.push(root)

    const skillDir = join(root, 'skills', 'db-core')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: db-core',
        'description: Core database concepts',
        'metadata:',
        '  type: framework',
        '---',
        '',
        'Skill content here.',
        '',
      ].join('\n'),
    )

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = errorSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(output).toContain('Framework skills must have a "requires" field')
  })

  it('validates package skills from repo root without root packaging warnings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      keywords: ['tanstack-intent'],
      files: ['skills', '!skills/_artifacts'],
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate', 'packages/router/skills'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
  })

  it('validates nested pnpm workspace package skills from the repo root', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-nested-pnpm-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/typescript/*\n',
    )

    for (const packageName of ['ai', 'ai-code-mode']) {
      const packageDir = join(root, 'packages', 'typescript', packageName)
      writeJson(join(packageDir, 'package.json'), {
        name: `@tanstack/${packageName}`,
        devDependencies: { '@tanstack/intent': '^0.0.18' },
        keywords: ['tanstack-intent'],
        files: ['skills'],
      })
      writeSkillMd(join(packageDir, 'skills', 'core'), {
        name: 'core',
        description: `${packageName} skill`,
      })
    }

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 2 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
    expect(output).not.toContain('Missing "tanstack-intent" in keywords array')
  })

  it('validates nested package.json workspace package skills from the repo root', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-nested-yarn-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/typescript/*'],
    })

    for (const packageName of ['ai', 'ai-code-mode']) {
      const packageDir = join(root, 'packages', 'typescript', packageName)
      writeJson(join(packageDir, 'package.json'), {
        name: `@tanstack/${packageName}`,
        devDependencies: { '@tanstack/intent': '^0.0.18' },
        keywords: ['tanstack-intent'],
        files: ['skills'],
      })
      writeSkillMd(join(packageDir, 'skills', 'core'), {
        name: 'core',
        description: `${packageName} skill`,
      })
    }

    process.chdir(root)

    const exitCode = await main(['validate'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 2 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
    expect(output).not.toContain('Missing "tanstack-intent" in keywords array')
  })

  it('validates only the explicit skills directory when one is passed', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-validate-explicit-nested-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/typescript/*'],
    })
    writeJson(join(root, 'packages', 'typescript', 'ai', 'package.json'), {
      name: '@tanstack/ai',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      keywords: ['tanstack-intent'],
      files: ['skills'],
    })
    writeJson(
      join(root, 'packages', 'typescript', 'ai-code-mode', 'package.json'),
      {
        name: '@tanstack/ai-code-mode',
        devDependencies: { '@tanstack/intent': '^0.0.18' },
        keywords: ['tanstack-intent'],
        files: ['skills'],
      },
    )
    writeSkillMd(join(root, 'packages', 'typescript', 'ai', 'skills', 'core'), {
      name: 'core',
      description: 'AI skill',
    })
    writeSkillMd(
      join(root, 'packages', 'typescript', 'ai-code-mode', 'skills', 'bad'),
      {
        name: 'not-bad',
        description: 'Invalid skill outside the explicit target',
      },
    )

    process.chdir(root)

    const exitCode = await main(['validate', 'packages/typescript/ai/skills'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('not-bad')
  })

  it('validates pnpm workspace package skills from repo root without false packaging warnings', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-pnpm-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
      devDependencies: { '@tanstack/intent': '^0.0.18' },
      keywords: ['tanstack-intent'],
      files: ['skills'],
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate', 'packages/router/skills'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('✅ Validated 1 skill files — all passed')
    expect(output).not.toContain('@tanstack/intent is not in devDependencies')
    expect(output).not.toContain(
      '"!skills/_artifacts" is not in the "files" array',
    )
  })

  it('skips cleanly when validate is run without a skills directory', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-missing-skills-'))
    tempDirs.push(root)
    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      'No skills/ directory found — skipping validation.',
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('writes a GitHub summary when validation fails', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-validate-summary-'))
    tempDirs.push(root)
    const previousSummary = process.env.GITHUB_STEP_SUMMARY
    const summaryPath = join(root, 'summary.md')
    writeSkillMd(join(root, 'skills', 'db-core'), {
      name: 'wrong-name',
      description: 'Core database concepts',
    })
    process.chdir(root)
    process.env.GITHUB_STEP_SUMMARY = summaryPath

    try {
      const exitCode = await main(['validate', '--github-summary'])
      const summary = readFileSync(summaryPath, 'utf8')

      expect(exitCode).toBe(1)
      expect(summary).toContain('Skill validation failed.')
      expect(summary).toContain('Why this failed:')
      expect(summary).toContain(
        'name "wrong-name" does not match parent directory "db-core"',
      )
    } finally {
      if (previousSummary === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummary
      }
    }
  })

  it('fails cleanly when the Yarn PnP API cannot be loaded', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-pnp-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    writeFileSync(join(root, '.pnp.cjs'), 'module.exports = {}\n')
    process.chdir(root)

    const exitCode = await main(['list'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Yarn PnP project detected, but Intent could not load Yarn',
      ),
    )
  })

  it('fails cleanly for deno projects without node_modules', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-deno-'))
    tempDirs.push(root)
    writeJson(join(root, 'package.json'), { name: 'app', private: true })
    writeFileSync(join(root, 'deno.json'), '{"nodeModulesDir":"none"}\n')
    process.chdir(root)

    const exitCode = await main(['list'])

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Deno without node_modules is not yet supported. Add `"nodeModulesDir": "auto"` to your deno.json to use intent.',
    )
  })

  it('checks workspace packages for staleness from the monorepo root', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-mono-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')

    fetchSpy.mockRestore()
  })

  it('prefers workspace package staleness when the workspace root has a skills directory', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-root-skills-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    mkdirSync(join(root, 'skills'), { recursive: true })
    writeJson(join(root, 'packages', 'router-core', 'package.json'), {
      name: '@tanstack/router-core',
    })
    writeSkillMd(
      join(root, 'packages', 'router-core', 'skills', 'router-core'),
      {
        name: 'router-core',
        description: 'Router core skill',
        library_version: '1.0.0',
      },
    )
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills:',
        "  - name: 'Router Core'",
        "    slug: 'router-core'",
        "    path: 'skills/router-core/SKILL.md'",
        "    package: 'packages/router-core'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      library: string
      signals?: Array<{
        type: string
        skill?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(reports.map((report) => report.library)).toEqual([
      '@tanstack/router-core',
    ])
    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'artifact-skill-missing',
          skill: 'router-core',
        }),
      ]),
    )

    fetchSpy.mockRestore()
  })

  it('flags workspace packages missing skill and artifact coverage', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-coverage-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills:',
        "  - name: 'Routing'",
        "    slug: 'routing'",
        "    path: 'packages/router/skills/routing/SKILL.md'",
        "    package: 'packages/router'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(signals).toEqual([
      expect.objectContaining({
        type: 'missing-package-coverage',
        packageName: '@tanstack/react-start-rsc',
      }),
    ])

    fetchSpy.mockRestore()
  })

  it('does not flag workspace packages ignored in artifact coverage', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-coverage-ignore-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'coverage:',
        '  ignored_packages:',
        "    - '@tanstack/react-start-rsc'",
        'skills:',
        "  - name: 'Routing'",
        "    slug: 'routing'",
        "    path: 'packages/router/skills/routing/SKILL.md'",
        "    package: 'packages/router'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'missing-package-coverage',
          packageName: '@tanstack/react-start-rsc',
        }),
      ]),
    )

    fetchSpy.mockRestore()
  })

  it('does not flag private workspace packages as missing coverage', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-private-coverage-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*', 'examples/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'examples', 'start-rsc', 'package.json'), {
      name: 'start-rsc-example',
      private: true,
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills:',
        "  - name: 'Routing'",
        "    slug: 'routing'",
        "    path: 'packages/router/skills/routing/SKILL.md'",
        "    package: 'packages/router'",
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>
    const signals = reports.flatMap((report) => report.signals ?? [])

    expect(exitCode).toBe(0)
    expect(signals).toEqual([
      expect.objectContaining({
        type: 'missing-package-coverage',
        packageName: '@tanstack/react-start-rsc',
      }),
    ])
    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'missing-package-coverage',
          packageName: 'start-rsc-example',
        }),
      ]),
    )

    fetchSpy.mockRestore()
  })

  it('flags missing coverage even when no workspace package has generated skills yet', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-all-missing-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'react-start-rsc', 'package.json'), {
      name: '@tanstack/react-start-rsc',
    })
    mkdirSync(join(root, '_artifacts'), { recursive: true })
    writeFileSync(
      join(root, '_artifacts', 'skill_tree.yaml'),
      [
        'library:',
        "  name: '@tanstack/router'",
        "  version: '1.0.0'",
        'skills: []',
      ].join('\n'),
    )

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{
      signals?: Array<{
        type: string
        packageName?: string
      }>
    }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.signals).toEqual([
      expect.objectContaining({
        type: 'missing-package-coverage',
        packageName: '@tanstack/react-start-rsc',
      }),
    ])

    fetchSpy.mockRestore()
  })

  it('ignores configured global intent packages when checking staleness', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-global-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-global-node-modules-'),
    )
    tempDirs.push(root, globalRoot)

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
      library_version: '5.0.0',
    })

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '')

    expect(exitCode).toBe(0)
    expect(output).toBe('[]')
  })

  it('checks only local packages for staleness when globals also exist', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-mixed-'))
    const globalRoot = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-mixed-global-'),
    )
    tempDirs.push(root, globalRoot)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Local routing skill',
      library_version: '1.0.0',
    })

    const globalPkgDir = join(globalRoot, '@tanstack', 'query')
    writeJson(join(globalPkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd(join(globalPkgDir, 'skills', 'fetching'), {
      name: 'fetching',
      description: 'Global fetching skill',
      library_version: '5.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    process.chdir(root)

    const exitCode = await main(['stale', '--json'])
    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
    const reports = JSON.parse(output) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')

    fetchSpy.mockRestore()
  })

  it('checks only the targeted workspace package for staleness', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-target-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'query', 'package.json'), {
      name: '@tanstack/query',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    writeSkillMd(join(root, 'packages', 'query', 'skills', 'cache'), {
      name: 'cache',
      description: 'Caching skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', 'packages/router/skills', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('checks only the targeted workspace package when path omits /skills suffix', async () => {
    const root = mkdtempSync(
      join(realTmpdir, 'intent-cli-stale-target-nosuffix-'),
    )
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'query', 'package.json'), {
      name: '@tanstack/query',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    writeSkillMd(join(root, 'packages', 'query', 'skills', 'cache'), {
      name: 'cache',
      description: 'Caching skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(root)

    const exitCode = await main(['stale', 'packages/router', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('checks the current workspace package for staleness from package cwd', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-package-cwd-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(root, 'packages', 'router', 'package.json'), {
      name: '@tanstack/router',
    })
    writeJson(join(root, 'packages', 'query', 'package.json'), {
      name: '@tanstack/query',
    })
    writeSkillMd(join(root, 'packages', 'router', 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })
    writeSkillMd(join(root, 'packages', 'query', 'skills', 'cache'), {
      name: 'cache',
      description: 'Caching skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    process.chdir(join(root, 'packages', 'router'))

    const exitCode = await main(['stale', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('handles absolute targetDir path correctly', async () => {
    const root = mkdtempSync(join(realTmpdir, 'intent-cli-stale-abs-'))
    tempDirs.push(root)

    writeJson(join(root, 'package.json'), {
      name: '@tanstack/router',
      version: '1.0.0',
    })
    writeSkillMd(join(root, 'skills', 'routing'), {
      name: 'routing',
      description: 'Routing skill',
      library_version: '1.0.0',
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    } as Response)

    const elsewhere = mkdtempSync(join(realTmpdir, 'intent-cli-stale-abs-cwd-'))
    tempDirs.push(elsewhere)
    process.chdir(elsewhere)

    const exitCode = await main(['stale', root, '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const reports = JSON.parse(String(output)) as Array<{ library: string }>

    expect(exitCode).toBe(0)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.library).toBe('@tanstack/router')

    fetchSpy.mockRestore()
  })
})

describe('package metadata', () => {
  it('uses a package-manager-neutral prepack script', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.prepack).toBe('npm run build')
  })
})

describe('isMainModule', () => {
  const modulePath = fileURLToPath(import.meta.url)
  const moduleUrl = pathToFileURL(modulePath).href
  const otherPath = join(dirname(modulePath), 'other.mjs')

  it('returns false when there is no argv script path', () => {
    expect(isMainModule(moduleUrl, undefined, () => modulePath)).toBe(false)
  })

  it('returns true when the resolved argv path matches the module', () => {
    const symlinkPath = join(dirname(modulePath), 'link')
    const realpath = (path: string) =>
      path === symlinkPath ? modulePath : path

    expect(isMainModule(moduleUrl, symlinkPath, realpath)).toBe(true)
  })

  it('returns false when the resolved argv path is a different module', () => {
    expect(isMainModule(moduleUrl, otherPath, (path) => path)).toBe(false)
  })

  it('returns false when resolving the argv path throws', () => {
    expect(
      isMainModule(moduleUrl, otherPath, () => {
        throw new Error('ENOENT')
      }),
    ).toBe(false)
  })
})
