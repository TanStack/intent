import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCurrentLockfileSources } from '../src/core/lockfile/lockfile-state.js'
import type { IntentPackage } from '../src/shared/types.js'

const roots: Array<string> = []

function packageFixture(kind: 'npm' | 'workspace' = 'npm'): {
  pkg: IntentPackage
  first: string
  second: string
} {
  const root = mkdtempSync(join(tmpdir(), 'intent-lock-state-'))
  const first = join(root, 'skills', 'first', 'SKILL.md')
  const second = join(root, 'skills', 'second', 'SKILL.md')
  mkdirSync(join(root, 'skills', 'first'), { recursive: true })
  mkdirSync(join(root, 'skills', 'second'), { recursive: true })
  writeFileSync(first, 'First')
  writeFileSync(second, 'Second')
  roots.push(root)
  return {
    pkg: {
      name: 'example',
      version: '1.0.0',
      kind,
      source: 'local',
      packageRoot: root,
      intent: { version: 1, repo: '', docs: '' },
      skills: [
        { name: 'second', path: second, description: '' },
        { name: 'first', path: 'skills/first/SKILL.md', description: '' },
      ],
    },
    first,
    second,
  }
}

afterEach(() => {
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }))
})

describe('buildCurrentLockfileSources', () => {
  it('builds independent hashes with package-relative skill directories', () => {
    const { pkg, first } = packageFixture()
    const initial = buildCurrentLockfileSources([pkg])
    writeFileSync(first, 'Changed')
    const updated = buildCurrentLockfileSources([pkg])
    expect(initial[0]!.skills.map((skill) => skill.path)).toEqual([
      'skills/first',
      'skills/second',
    ])
    expect(updated[0]!.skills[0]!.contentHash).not.toBe(
      initial[0]!.skills[0]!.contentHash,
    )
    expect(updated[0]!.skills[1]!.contentHash).toBe(
      initial[0]!.skills[1]!.contentHash,
    )
  })

  it('keeps npm and workspace sources with the same id distinct', () => {
    const npm = packageFixture('npm').pkg
    const workspace = {
      ...packageFixture('workspace').pkg,
      packageRoot: npm.packageRoot,
      skills: npm.skills,
    }
    expect(
      buildCurrentLockfileSources([workspace, npm]).map(
        (source) => source.kind,
      ),
    ).toEqual(['npm', 'workspace'])
  })

  it('resolves npm and workspace paths rewritten for loading', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'intent-lock-project-'))
    roots.push(projectRoot)
    const npmRoot = join(projectRoot, 'node_modules', '@scope', 'package')
    const workspaceRoot = join(projectRoot, 'packages', 'workspace')
    const npmSkill = join(npmRoot, 'skills', 'npm-skill', 'SKILL.md')
    const workspaceSkill = join(
      workspaceRoot,
      'skills',
      'workspace-skill',
      'SKILL.md',
    )
    mkdirSync(join(npmRoot, 'skills', 'npm-skill'), { recursive: true })
    mkdirSync(join(workspaceRoot, 'skills', 'workspace-skill'), {
      recursive: true,
    })
    writeFileSync(npmSkill, 'Npm')
    writeFileSync(workspaceSkill, 'Workspace')

    const npm = packageFixture().pkg
    npm.name = '@scope/package'
    npm.packageRoot = npmRoot
    npm.skills = [
      {
        name: 'npm-skill',
        path: 'node_modules/@scope/package/skills/npm-skill/SKILL.md',
        description: '',
      },
    ]
    const workspace = packageFixture('workspace').pkg
    workspace.name = 'workspace-package'
    workspace.packageRoot = workspaceRoot
    workspace.skills = [
      {
        name: 'workspace-skill',
        path: 'packages/workspace/skills/workspace-skill/SKILL.md',
        description: '',
      },
    ]

    expect(buildCurrentLockfileSources([workspace, npm])).toMatchObject([
      { kind: 'npm', skills: [{ path: 'skills/npm-skill' }] },
      {
        kind: 'workspace',
        skills: [{ path: 'skills/workspace-skill' }],
      },
    ])
  })
})
