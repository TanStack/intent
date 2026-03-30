import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectContext } from '../src/core/project-context.js'

const roots: Array<string> = []

function createRoot(): string {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'project-context-test-')),
  )
  roots.push(root)
  return root
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

function createPnpmWorkspaceRoot(root: string): void {
  writeJson(join(root, 'package.json'), { name: 'repo-root', private: true })
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n',
  )
}

function createWorkspacePackage(root: string, name: string): string {
  const packageRoot = join(root, 'packages', name)
  writeJson(join(packageRoot, 'package.json'), { name: `@scope/${name}` })
  mkdirSync(join(packageRoot, 'skills'), { recursive: true })
  return packageRoot
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveProjectContext', () => {
  it('resolves the workspace root from the workspace cwd', () => {
    const root = createRoot()
    createPnpmWorkspaceRoot(root)

    const context = resolveProjectContext({ cwd: root })

    expect(context).toEqual({
      cwd: root,
      workspaceRoot: root,
      packageRoot: root,
      isMonorepo: true,
      workspacePatterns: ['packages/*'],
      targetPackageJsonPath: join(root, 'package.json'),
      targetSkillsDir: null,
    })
  })

  it('resolves the owning workspace package from a package cwd', () => {
    const root = createRoot()
    createPnpmWorkspaceRoot(root)
    const packageRoot = createWorkspacePackage(root, 'router')

    const context = resolveProjectContext({ cwd: packageRoot })

    expect(context).toEqual({
      cwd: packageRoot,
      workspaceRoot: root,
      packageRoot,
      isMonorepo: true,
      workspacePatterns: ['packages/*'],
      targetPackageJsonPath: join(packageRoot, 'package.json'),
      targetSkillsDir: join(packageRoot, 'skills'),
    })
  })

  it('resolves an explicit skills dir path back to the owning package', () => {
    const root = createRoot()
    createPnpmWorkspaceRoot(root)
    const packageRoot = createWorkspacePackage(root, 'query')

    const context = resolveProjectContext({
      cwd: root,
      targetPath: 'packages/query/skills',
    })

    expect(context).toEqual({
      cwd: root,
      workspaceRoot: root,
      packageRoot,
      isMonorepo: true,
      workspacePatterns: ['packages/*'],
      targetPackageJsonPath: join(packageRoot, 'package.json'),
      targetSkillsDir: join(packageRoot, 'skills'),
    })
  })

  it('resolves a standalone project with no workspace', () => {
    const root = createRoot()
    writeJson(join(root, 'package.json'), { name: 'standalone-pkg' })
    mkdirSync(join(root, 'skills'), { recursive: true })

    const context = resolveProjectContext({ cwd: root })

    expect(context).toEqual({
      cwd: root,
      workspaceRoot: null,
      packageRoot: root,
      isMonorepo: false,
      workspacePatterns: [],
      targetPackageJsonPath: join(root, 'package.json'),
      targetSkillsDir: join(root, 'skills'),
    })
  })

  it('detects pnpm workspaces without package.json workspaces', () => {
    const root = createRoot()
    createPnpmWorkspaceRoot(root)
    const packageRoot = createWorkspacePackage(root, 'table')

    const context = resolveProjectContext({
      cwd: root,
      targetPath: 'packages/table',
    })

    expect(context.workspaceRoot).toBe(root)
    expect(context.workspacePatterns).toEqual(['packages/*'])
    expect(context.isMonorepo).toBe(true)
    expect(context.packageRoot).toBe(packageRoot)
  })

  it('detects Deno workspaces from a workspace package cwd', () => {
    const root = createRoot()
    writeJson(join(root, 'package.json'), { name: 'repo-root', private: true })
    writeFileSync(
      join(root, 'deno.jsonc'),
      `{
        "workspace": [
          "packages/*",
        ],
      }
      `,
    )
    const packageRoot = createWorkspacePackage(root, 'router')

    const context = resolveProjectContext({ cwd: packageRoot })

    expect(context).toEqual({
      cwd: packageRoot,
      workspaceRoot: root,
      packageRoot,
      isMonorepo: true,
      workspacePatterns: ['packages/*'],
      targetPackageJsonPath: join(packageRoot, 'package.json'),
      targetSkillsDir: join(packageRoot, 'skills'),
    })
  })
})
