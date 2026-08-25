import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanInstallCandidateInventory } from '../src/commands/install/candidate-inventory.js'
import {
  buildInstallReview,
  getInstallReviewSkillPath,
  getInstallReviewSkillStatus,
  getInstallReviewSourceIdentity,
  getInstallReviewSourceStatus,
  isInstallReviewSkillEligible,
} from '../src/commands/install/review.js'
import { computeSkillContentHash } from '../src/core/lockfile/hash.js'
import {
  readIntentLockfile,
  serializeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'
import { createIntentFsCache } from '../src/discovery/fs-cache.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type { InstallReviewResult } from '../src/commands/install/review.js'
import type {
  IntentLockfile,
  IntentLockfileSource,
} from '../src/core/lockfile/lockfile.js'
import type { ReadFs } from '../src/shared/utils.js'

let root: string

function fakeHash(seed: string): string {
  return `sha256-${seed.repeat(64)}`
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function writeIntentPackage(
  packageRoot: string,
  name: string,
  version: string,
  skills: ReadonlyArray<string>,
): void {
  writeJson(join(packageRoot, 'package.json'), {
    name,
    version,
    intent: { version: 1, repo: `test/${name}`, docs: 'docs/' },
  })
  for (const skill of skills) {
    writeFile(
      join(packageRoot, 'skills', skill, 'SKILL.md'),
      `---\ndescription: ${skill}\n---\n`,
    )
  }
}

function hashSkill(packageRoot: string, skill: string): string {
  return computeSkillContentHash({
    packageRoot,
    skillDir: `skills/${skill}`,
  })
}

function writeLock(sources: Array<IntentLockfileSource>): void {
  writeFile(
    join(root, 'intent.lock'),
    serializeIntentLockfile({ lockfileVersion: 1, sources }),
  )
}

function findSource(
  result: InstallReviewResult,
  id: string,
  kind: 'npm' | 'workspace' = 'npm',
): InstallReviewResult['sources'][number] {
  const source = result.sources.find((candidate) => {
    const identity = getInstallReviewSourceIdentity(candidate)
    return identity.kind === kind && identity.id === id
  })
  if (source === undefined) {
    throw new Error(`Expected review source ${kind}:${id}`)
  }
  return source
}

function projectSource(source: InstallReviewResult['sources'][number]) {
  return {
    status: getInstallReviewSourceStatus(source),
    ...getInstallReviewSourceIdentity(source),
    currentVersion: source.current?.observedVersion ?? null,
    acceptedVersion: source.accepted?.observedVersion ?? null,
    skills: source.skills.map((skill) => ({
      status: getInstallReviewSkillStatus(source, skill),
      path: getInstallReviewSkillPath(skill),
      eligible: isInstallReviewSkillEligible(skill),
      currentHash: skill.current?.contentHash ?? null,
      acceptedHash: skill.accepted?.contentHash ?? null,
    })),
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-review-test-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('buildInstallReview', () => {
  it('returns current candidates as new without creating install outputs when the lock is missing', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      packageManager: 'npm@10.0.0',
      dependencies: { pkg: '1.0.0' },
      intent: {
        skills: ['pkg#selected'],
        exclude: ['pkg#excluded'],
      },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeIntentPackage(packageRoot, 'pkg', '1.0.0', [
      'selected',
      'withheld',
      'excluded',
    ])

    const result = buildInstallReview(root)
    const projection = projectSource(findSource(result, 'pkg'))

    expect(result.packageManager).toBe('npm')
    expect(result.lock).toEqual({ status: 'missing' })
    expect(result.contentIsClean).toBe(false)
    expect(projection).toMatchObject({
      status: 'new',
      kind: 'npm',
      id: 'pkg',
      currentVersion: '1.0.0',
      acceptedVersion: null,
      skills: [
        { status: 'new', path: 'skills/excluded', eligible: false },
        { status: 'new', path: 'skills/selected', eligible: true },
        { status: 'new', path: 'skills/withheld', eligible: false },
      ],
    })
    expect(projection.skills.every((skill) => skill.currentHash !== null)).toBe(
      true,
    )
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('keeps accepted state separate from policy eligibility', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { pkg: '1.0.0', 'package-excluded': '1.0.0' },
      intent: {
        skills: ['pkg#selected'],
        exclude: ['pkg#excluded', 'package-excluded'],
      },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeIntentPackage(packageRoot, 'pkg', '1.0.0', [
      'selected',
      'withheld',
      'excluded',
    ])
    const packageExcludedRoot = join(root, 'node_modules', 'package-excluded')
    writeIntentPackage(
      packageExcludedRoot,
      'package-excluded',
      '1.0.0',
      ['core'],
    )
    writeLock([
      {
        kind: 'npm',
        id: 'pkg',
        observedVersion: '1.0.0',
        skills: ['selected', 'withheld', 'excluded'].map((skill) => ({
          path: `skills/${skill}`,
          contentHash: hashSkill(packageRoot, skill),
        })),
      },
      {
        kind: 'npm',
        id: 'package-excluded',
        observedVersion: '1.0.0',
        skills: [
          {
            path: 'skills/core',
            contentHash: hashSkill(packageExcludedRoot, 'core'),
          },
        ],
      },
    ])

    const result = buildInstallReview(root)
    const packageSource = findSource(result, 'pkg')
    const packageExcludedSource = findSource(result, 'package-excluded')

    expect(result.lock.status).toBe('found')
    expect(result.contentIsClean).toBe(true)
    expect(projectSource(packageSource).skills).toMatchObject([
      { status: 'accepted', path: 'skills/excluded', eligible: false },
      { status: 'accepted', path: 'skills/selected', eligible: true },
      { status: 'accepted', path: 'skills/withheld', eligible: false },
    ])
    expect(packageSource.current).toMatchObject({
      permitted: true,
      excluded: false,
    })
    expect(projectSource(packageExcludedSource).skills).toMatchObject([
      { status: 'accepted', path: 'skills/core', eligible: false },
    ])
    expect(packageExcludedSource.current).toMatchObject({
      permitted: false,
      excluded: true,
    })
  })

  it('keeps current metadata, canonical accepted state, and active ReadFs across version drift', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      packageManager: 'npm@10.0.0',
      dependencies: { pkg: '2.0.0' },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '2.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    writeFile(
      join(packageRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: Core workflow\ntype: core\nframework: React\n---\n',
    )
    const contentHash = hashSkill(packageRoot, 'core')
    const acceptedLock: IntentLockfile = {
      lockfileVersion: 1,
      sources: [
        {
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          skills: [{ path: 'skills/core', contentHash }],
        },
      ],
    }
    writeLock(acceptedLock.sources)
    const activeFs: ReadFs = {
      ...nodeReadFs,
      opendirSync: ((...args: Array<unknown>) =>
        Reflect.apply(opendirSync, undefined, args)) as ReadFs['opendirSync'],
    }
    const fsCache = createIntentFsCache()
    fsCache.useFs(activeFs)
    const scanOptions = { scope: 'local' as const, fsCache }

    const result = buildInstallReview(root, {
      scanOptions,
    })
    const source = findSource(result, 'pkg')

    expect(result.readFs).toBe(activeFs)
    expect(result.lock).toEqual({ status: 'found', value: acceptedLock })
    expect(projectSource(source)).toMatchObject({
      status: 'available',
      currentVersion: '2.0.0',
      acceptedVersion: '1.0.0',
      skills: [{ status: 'accepted', path: 'skills/core', eligible: true }],
    })
    expect(source.current).toMatchObject({
      packageRoot,
      source: 'local',
      provenance: 'direct',
    })
    expect(source.skills[0]?.current).toMatchObject({
      name: 'core',
      description: 'Core workflow',
      type: 'core',
      framework: 'React',
      use: 'pkg#core',
    })
  })

  it('hydrates mixed skill relations in canonical diff order', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { pkg: '1.0.0' },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeIntentPackage(packageRoot, 'pkg', '1.0.0', [
      'new',
      'changed',
      'accepted',
    ])
    const acceptedHash = hashSkill(packageRoot, 'accepted')
    const changedHash = hashSkill(packageRoot, 'changed')
    const newHash = hashSkill(packageRoot, 'new')
    writeLock([
      {
        kind: 'npm',
        id: 'pkg',
        observedVersion: '1.0.0',
        skills: [
          { path: 'skills/accepted', contentHash: acceptedHash },
          { path: 'skills/changed', contentHash: fakeHash('b') },
          { path: 'skills/removed', contentHash: fakeHash('c') },
        ],
      },
    ])

    const result = buildInstallReview(root)

    expect(result.contentIsClean).toBe(false)
    expect(projectSource(findSource(result, 'pkg'))).toEqual({
      status: 'available',
      kind: 'npm',
      id: 'pkg',
      currentVersion: '1.0.0',
      acceptedVersion: '1.0.0',
      skills: [
        {
          status: 'accepted',
          path: 'skills/accepted',
          eligible: true,
          currentHash: acceptedHash,
          acceptedHash,
        },
        {
          status: 'changed',
          path: 'skills/changed',
          eligible: true,
          currentHash: changedHash,
          acceptedHash: fakeHash('b'),
        },
        {
          status: 'new',
          path: 'skills/new',
          eligible: true,
          currentHash: newHash,
          acceptedHash: null,
        },
        {
          status: 'removed',
          path: 'skills/removed',
          eligible: false,
          currentHash: null,
          acceptedHash: fakeHash('c'),
        },
      ],
    })
  })

  it('returns accepted-only sources and skills without current fields', () => {
    writeJson(join(root, 'package.json'), { name: 'app' })
    writeLock([
      {
        kind: 'npm',
        id: 'missing-pkg',
        observedVersion: '4.0.0',
        skills: [
          { path: 'skills/unavailable', contentHash: fakeHash('d') },
        ],
      },
    ])

    const result = buildInstallReview(root)

    expect(result.contentIsClean).toBe(false)
    expect(projectSource(findSource(result, 'missing-pkg'))).toEqual({
      status: 'unavailable',
      kind: 'npm',
      id: 'missing-pkg',
      currentVersion: null,
      acceptedVersion: '4.0.0',
      skills: [
        {
          status: 'unavailable',
          path: 'skills/unavailable',
          eligible: false,
          currentHash: null,
          acceptedHash: fakeHash('d'),
        },
      ],
    })
  })

  it('keeps npm and workspace sources with the same id in canonical diff order', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      workspaces: ['packages/*'],
      dependencies: { consumer: '1.0.0' },
    })
    const workspaceRoot = join(root, 'packages', 'shared')
    writeIntentPackage(workspaceRoot, 'shared', '2.0.0', ['workspace-skill'])
    const consumerRoot = join(root, 'node_modules', 'consumer')
    writeJson(join(consumerRoot, 'package.json'), {
      name: 'consumer',
      version: '1.0.0',
      dependencies: { shared: '1.0.0' },
    })
    const npmRoot = join(consumerRoot, 'node_modules', 'shared')
    writeIntentPackage(npmRoot, 'shared', '1.0.0', ['npm-skill'])
    symlinkSync(workspaceRoot, join(root, 'node_modules', 'shared'), 'dir')

    const result = buildInstallReview(root)

    expect(result.warnings).toEqual([
      expect.stringContaining('Found 2 installed variants of shared'),
    ])
    expect(result.conflicts).toEqual([
      expect.objectContaining({ packageName: 'shared' }),
    ])
    expect(result.sources.map(projectSource)).toMatchObject([
      { status: 'new', kind: 'npm', id: 'shared' },
      { status: 'new', kind: 'workspace', id: 'shared' },
    ])
  })

  it('propagates invalid lockfile parse errors', () => {
    writeJson(join(root, 'package.json'), { name: 'app' })
    writeFile(join(root, 'intent.lock'), '{ invalid json')

    expect(() => buildInstallReview(root)).toThrow(SyntaxError)
  })

  it('propagates unsafe lockfile read errors', () => {
    writeJson(join(root, 'package.json'), { name: 'app' })
    const target = join(root, 'lock-target')
    writeFile(
      target,
      serializeIntentLockfile({ lockfileVersion: 1, sources: [] }),
    )
    symlinkSync(target, join(root, 'intent.lock'))

    expect(() => buildInstallReview(root)).toThrow(
      'intent.lock must not be a symbolic link',
    )
  })

  it('does not mutate observable inventory, lock, or filesystem inputs', () => {
    const packageJsonPath = join(root, 'package.json')
    writeJson(packageJsonPath, {
      name: 'app',
      dependencies: { pkg: '1.0.0' },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeIntentPackage(packageRoot, 'pkg', '1.0.0', ['core'])
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    const contentHash = hashSkill(packageRoot, 'core')
    const lockPath = join(root, 'intent.lock')
    writeLock([
      {
        kind: 'npm',
        id: 'pkg',
        observedVersion: '1.0.0',
        skills: [{ path: 'skills/core', contentHash }],
      },
    ])
    const fsCache = createIntentFsCache()
    const options = { scanOptions: { scope: 'local' as const, fsCache } }
    const inventory = scanInstallCandidateInventory(root, options)
    const inventorySnapshot = structuredClone({
      packageManager: inventory.packageManager,
      sources: inventory.sources,
      warnings: inventory.warnings,
      conflicts: inventory.conflicts,
    })
    const locked = readIntentLockfile(lockPath)
    const lockedSnapshot = structuredClone(locked)
    const rootEntries = readdirSync(root)
    const packageJson = readFileSync(packageJsonPath)
    const skill = readFileSync(skillPath)
    const lock = readFileSync(lockPath)

    buildInstallReview(root, options)

    expect({
      packageManager: inventory.packageManager,
      sources: inventory.sources,
      warnings: inventory.warnings,
      conflicts: inventory.conflicts,
    }).toEqual(inventorySnapshot)
    expect(inventory.readFs).toBe(fsCache.getReadFs())
    expect(locked).toEqual(lockedSnapshot)
    expect(readdirSync(root)).toEqual(rootEntries)
    expect(readFileSync(packageJsonPath)).toEqual(packageJson)
    expect(readFileSync(skillPath)).toEqual(skill)
    expect(readFileSync(lockPath)).toEqual(lock)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })
})
