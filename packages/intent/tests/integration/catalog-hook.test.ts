import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  tempDirs.push(root)
  return root
}

describe('built project Copilot catalogue hook', () => {
  it('uses the installed catalogue API and reuses its cache', () => {
    const root = tempRoot('intent-catalog-hook-integration-')
    const packageRoot = join(import.meta.dirname, '..', '..')
    const intentDir = join(root, 'node_modules', '@tanstack', 'intent')
    const skillDir = join(
      root,
      'node_modules',
      '@fixture',
      'router',
      'skills',
      'routing',
    )
    copyBuiltPackage(packageRoot, intentDir)
    copyRuntimeDependencies(packageRoot, root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'catalog-hook-integration',
        private: true,
        dependencies: {
          '@fixture/router': '1.0.0',
          '@tanstack/intent': '0.3.6',
        },
        intent: { skills: ['@fixture/router'] },
      }),
    )
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(root, 'node_modules', '@fixture', 'router', 'package.json'),
      JSON.stringify({
        name: '@fixture/router',
        version: '1.0.0',
        intent: { version: 1, repo: 'fixture/router', docs: 'docs/' },
      }),
    )
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: routing\ndescription: Router lifecycle guidance\n---\n\nBody.\n',
    )
    const cliPath = join(
      root,
      'node_modules',
      '@tanstack',
      'intent',
      'dist',
      'cli.mjs',
    )
    const install = spawnSync(
      process.execPath,
      [cliPath, 'hooks', 'install', '--agents', 'copilot'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(install.status, install.stderr || install.stdout).toBe(0)
    const hookCommand = readSessionStartCommand(
      join(root, '.github', 'hooks', 'intent.json'),
    )
    const scriptPath = join(
      root,
      '.intent',
      'hooks',
      'intent-copilot-catalog.mjs',
    )
    expect(hookCommand).toContain('intent-copilot-catalog.mjs')

    const first = runHook(scriptPath, root)
    const second = runHook(scriptPath, root)

    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
    expect(JSON.parse(first.stdout).additionalContext).toContain(
      '@fixture/router#routing: Router lifecycle guidance',
    )
    expect(first.stderr).toContain('[intent catalog] SessionStart miss')
    expect(second.stderr).toContain('[intent catalog] SessionStart hit')
    expect(first.stderr).not.toContain('fallback=true')
    expect(second.stderr).not.toContain('fallback=true')
  })
})

function runHook(scriptPath: string, cwd: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({
      cwd,
      sessionId: 'integration-session',
      source: 'startup',
    }),
  })
}

function copyBuiltPackage(packageRoot: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  cpSync(join(packageRoot, 'dist'), join(destination, 'dist'), {
    recursive: true,
  })
  cpSync(join(packageRoot, 'package.json'), join(destination, 'package.json'))
}

function copyRuntimeDependencies(packageRoot: string, projectRoot: string) {
  for (const dependency of readRuntimeDependencyNames(packageRoot)) {
    const segments = dependency.split('/')
    const source = join(packageRoot, 'node_modules', ...segments)
    const destination = join(projectRoot, 'node_modules', ...segments)
    mkdirSync(join(destination, '..'), { recursive: true })
    cpSync(source, destination, { recursive: true, dereference: true })
  }
}

function readRuntimeDependencyNames(packageRoot: string): Array<string> {
  const parsed: unknown = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8'),
  )
  if (!isRecord(parsed)) {
    throw new TypeError('Expected Intent package.json to contain an object.')
  }
  const dependencies = parsed.dependencies
  if (!isRecord(dependencies)) {
    throw new TypeError('Expected Intent package.json dependencies.')
  }
  return Object.keys(dependencies)
}

function readSessionStartCommand(configPath: string): string {
  const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
    throw new TypeError('Expected Copilot hook configuration.')
  }
  const sessionStart = parsed.hooks.sessionStart
  const handler = Array.isArray(sessionStart) ? sessionStart[0] : undefined
  if (!isRecord(handler) || typeof handler.command !== 'string') {
    throw new TypeError('Expected Copilot sessionStart command hook.')
  }
  return handler.command
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
