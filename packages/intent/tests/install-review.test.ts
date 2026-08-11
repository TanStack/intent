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
import { buildInstallReview } from '../src/commands/install/review.js'
import { createIntentFsCache } from '../src/discovery/fs-cache.js'
import { computeSkillContentHash } from '../src/core/lockfile/hash.js'
import {
  readIntentLockfile,
  serializeIntentLockfile,
} from '../src/core/lockfile/lockfile.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type { ReadFs } from '../src/shared/utils.js'

const LOCKED_CHANGED_HASH = `sha256-${'b'.repeat(64)}`
const LOCKED_REMOVED_HASH = `sha256-${'c'.repeat(64)}`
const LOCKED_UNAVAILABLE_HASH = `sha256-${'d'.repeat(64)}`

let root: string

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
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
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    for (const skillName of ['selected', 'withheld', 'excluded']) {
      writeFile(
        join(packageRoot, 'skills', skillName, 'SKILL.md'),
        `---\ndescription: ${skillName}\n---\n`,
      )
    }

    const result = buildInstallReview(root)

    expect(result).toMatchObject({
      packageManager: 'npm',
      lockfile: 'missing',
      contentIsClean: false,
      sources: [
        {
          status: 'new',
          kind: 'npm',
          id: 'pkg',
          observedVersion: '1.0.0',
          packageRoot,
          source: 'local',
          provenance: 'direct',
          permitted: true,
          excluded: false,
          eligible: true,
          skills: [
            {
              status: 'new',
              name: 'excluded',
              description: 'excluded',
              use: 'pkg#excluded',
              path: 'skills/excluded',
              contentHash: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
              permitted: false,
              excluded: true,
              eligible: false,
            },
            {
              status: 'new',
              name: 'selected',
              description: 'selected',
              use: 'pkg#selected',
              path: 'skills/selected',
              contentHash: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
              permitted: true,
              excluded: false,
              eligible: true,
            },
            {
              status: 'new',
              name: 'withheld',
              description: 'withheld',
              use: 'pkg#withheld',
              path: 'skills/withheld',
              contentHash: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
              permitted: false,
              excluded: false,
              eligible: false,
            },
          ],
        },
      ],
    })
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('keeps accepted content status separate from policy eligibility for available locked sources', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { pkg: '1.0.0', 'package-excluded': '1.0.0' },
      intent: {
        skills: ['pkg#selected'],
        exclude: ['pkg#excluded', 'package-excluded'],
      },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    for (const skillName of ['selected', 'withheld', 'excluded']) {
      writeFile(
        join(packageRoot, 'skills', skillName, 'SKILL.md'),
        `---\ndescription: ${skillName}\n---\n`,
      )
    }
    const hashes = Object.fromEntries(
      ['selected', 'withheld', 'excluded'].map((skillName) => [
        skillName,
        computeSkillContentHash({
          packageRoot,
          skillDir: `skills/${skillName}`,
        }),
      ]),
    )
    const packageExcludedRoot = join(root, 'node_modules', 'package-excluded')
    writeJson(join(packageExcludedRoot, 'package.json'), {
      name: 'package-excluded',
      version: '1.0.0',
      intent: {
        version: 1,
        repo: 'test/package-excluded',
        docs: 'docs/',
      },
    })
    writeFile(
      join(packageExcludedRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: core\n---\n',
    )
    const packageExcludedHash = computeSkillContentHash({
      packageRoot: packageExcludedRoot,
      skillDir: 'skills/core',
    })
    writeFile(
      join(root, 'intent.lock'),
      serializeIntentLockfile({
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [
              { path: 'skills/selected', contentHash: hashes.selected! },
              { path: 'skills/withheld', contentHash: hashes.withheld! },
              { path: 'skills/excluded', contentHash: hashes.excluded! },
            ],
          },
          {
            kind: 'npm',
            id: 'package-excluded',
            observedVersion: '1.0.0',
            skills: [{ path: 'skills/core', contentHash: packageExcludedHash }],
          },
        ],
      }),
    )

    const result = buildInstallReview(root)

    expect(result.contentIsClean).toBe(true)
    expect(result.sources).toHaveLength(2)
    const packageSource = result.sources.find((source) => source.id === 'pkg')
    if (packageSource?.status !== 'available') {
      throw new Error('Expected pkg source to be available')
    }
    expect(packageSource).toMatchObject({
      status: 'available',
      permitted: true,
      excluded: false,
      eligible: true,
    })
    expect(
      Object.fromEntries(
        packageSource.skills.map((skill) => {
          if (skill.status !== 'accepted') {
            throw new Error(`Expected ${skill.path} skill to be accepted`)
          }
          return [
            skill.name,
            {
              status: skill.status,
              permitted: skill.permitted,
              excluded: skill.excluded,
              eligible: skill.eligible,
            },
          ]
        }),
      ),
    ).toEqual({
      selected: {
        status: 'accepted',
        permitted: true,
        excluded: false,
        eligible: true,
      },
      withheld: {
        status: 'accepted',
        permitted: false,
        excluded: false,
        eligible: false,
      },
      excluded: {
        status: 'accepted',
        permitted: false,
        excluded: true,
        eligible: false,
      },
    })
    const packageExcludedSource = result.sources.find(
      (source) => source.id === 'package-excluded',
    )
    if (packageExcludedSource?.status !== 'available') {
      throw new Error('Expected package-excluded source to be available')
    }
    expect(packageExcludedSource).toMatchObject({
      status: 'available',
      permitted: false,
      excluded: true,
      eligible: false,
    })
    expect(packageExcludedSource.skills).toHaveLength(1)
    const packageExcludedSkill = packageExcludedSource.skills[0]
    if (packageExcludedSkill?.status !== 'accepted') {
      throw new Error('Expected package-excluded skill to be accepted')
    }
    expect(packageExcludedSkill).toMatchObject({
      status: 'accepted',
      name: 'core',
      permitted: false,
      excluded: true,
      eligible: false,
    })
  })

  it('keeps accepted current metadata and active ReadFs across version-only drift', () => {
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
    const contentHash = computeSkillContentHash({
      packageRoot,
      skillDir: 'skills/core',
    })
    writeFile(
      join(root, 'intent.lock'),
      serializeIntentLockfile({
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ path: 'skills/core', contentHash }],
          },
        ],
      }),
    )
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

    expect(result.readFs).toBe(activeFs)
    expect(result).toMatchObject({
      packageManager: 'npm',
      warnings: [],
      conflicts: [],
      lockfile: 'found',
      contentIsClean: true,
      sources: [
        {
          status: 'available',
          kind: 'npm',
          id: 'pkg',
          observedVersion: '2.0.0',
          lockedObservedVersion: '1.0.0',
          versionChanged: true,
          packageRoot,
          source: 'local',
          provenance: 'direct',
          permitted: true,
          excluded: false,
          eligible: true,
          skills: [
            {
              status: 'accepted',
              name: 'core',
              description: 'Core workflow',
              type: 'core',
              framework: 'React',
              use: 'pkg#core',
              path: 'skills/core',
              contentHash,
              permitted: true,
              excluded: false,
              eligible: true,
            },
          ],
        },
      ],
    })
  })

  it('hydrates mixed skill statuses with exact current and locked hash fields', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { pkg: '1.0.0' },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    for (const skillName of ['new', 'changed', 'accepted']) {
      writeFile(
        join(packageRoot, 'skills', skillName, 'SKILL.md'),
        `---\ndescription: ${skillName} skill\n---\n`,
      )
    }
    const acceptedHash = computeSkillContentHash({
      packageRoot,
      skillDir: 'skills/accepted',
    })
    const changedHash = computeSkillContentHash({
      packageRoot,
      skillDir: 'skills/changed',
    })
    const newHash = computeSkillContentHash({
      packageRoot,
      skillDir: 'skills/new',
    })
    writeFile(
      join(root, 'intent.lock'),
      serializeIntentLockfile({
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [
              { path: 'skills/accepted', contentHash: acceptedHash },
              { path: 'skills/changed', contentHash: LOCKED_CHANGED_HASH },
              { path: 'skills/removed', contentHash: LOCKED_REMOVED_HASH },
            ],
          },
        ],
      }),
    )

    const result = buildInstallReview(root)

    expect(result.contentIsClean).toBe(false)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      status: 'available',
      id: 'pkg',
    })
    expect(result.sources[0]!.skills).toEqual([
      {
        status: 'accepted',
        name: 'accepted',
        description: 'accepted skill',
        use: 'pkg#accepted',
        path: 'skills/accepted',
        contentHash: acceptedHash,
        permitted: true,
        excluded: false,
        eligible: true,
      },
      {
        status: 'changed',
        name: 'changed',
        description: 'changed skill',
        use: 'pkg#changed',
        path: 'skills/changed',
        contentHash: changedHash,
        permitted: true,
        excluded: false,
        lockedContentHash: LOCKED_CHANGED_HASH,
        eligible: true,
      },
      {
        status: 'new',
        name: 'new',
        description: 'new skill',
        use: 'pkg#new',
        path: 'skills/new',
        contentHash: newHash,
        permitted: true,
        excluded: false,
        eligible: true,
      },
      {
        status: 'removed',
        path: 'skills/removed',
        lockedContentHash: LOCKED_REMOVED_HASH,
      },
    ])
  })

  it('returns locked-only sources and skills without fabricated current fields', () => {
    writeJson(join(root, 'package.json'), { name: 'app' })
    writeFile(
      join(root, 'intent.lock'),
      serializeIntentLockfile({
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'missing-pkg',
            observedVersion: '4.0.0',
            skills: [
              {
                path: 'skills/unavailable',
                contentHash: LOCKED_UNAVAILABLE_HASH,
              },
            ],
          },
        ],
      }),
    )

    const result = buildInstallReview(root)

    expect(result.contentIsClean).toBe(false)
    expect(result.sources).toEqual([
      {
        status: 'unavailable',
        kind: 'npm',
        id: 'missing-pkg',
        lockedObservedVersion: '4.0.0',
        skills: [
          {
            status: 'unavailable',
            path: 'skills/unavailable',
            lockedContentHash: LOCKED_UNAVAILABLE_HASH,
          },
        ],
      },
    ])
  })

  it('keeps npm and workspace sources with the same id in canonical diff order', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      workspaces: ['packages/*'],
      dependencies: { consumer: '1.0.0' },
    })
    const workspaceRoot = join(root, 'packages', 'shared')
    writeJson(join(workspaceRoot, 'package.json'), {
      name: 'shared',
      version: '2.0.0',
      intent: { version: 1, repo: 'test/workspace', docs: 'docs/' },
    })
    writeFile(
      join(workspaceRoot, 'skills', 'workspace-skill', 'SKILL.md'),
      '---\ndescription: Workspace skill\n---\n',
    )
    const consumerRoot = join(root, 'node_modules', 'consumer')
    writeJson(join(consumerRoot, 'package.json'), {
      name: 'consumer',
      version: '1.0.0',
      dependencies: { shared: '1.0.0' },
    })
    const npmRoot = join(consumerRoot, 'node_modules', 'shared')
    writeJson(join(npmRoot, 'package.json'), {
      name: 'shared',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/npm', docs: 'docs/' },
    })
    writeFile(
      join(npmRoot, 'skills', 'npm-skill', 'SKILL.md'),
      '---\ndescription: Npm skill\n---\n',
    )
    symlinkSync(workspaceRoot, join(root, 'node_modules', 'shared'), 'dir')

    const result = buildInstallReview(root)

    expect(result.warnings).toEqual([
      expect.stringContaining('Found 2 installed variants of shared'),
    ])
    expect(result.conflicts).toEqual([
      expect.objectContaining({ packageName: 'shared' }),
    ])
    expect(
      result.sources.map((source) => ({
        status: source.status,
        kind: source.kind,
        id: source.id,
      })),
    ).toEqual([
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
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    writeFile(skillPath, '---\ndescription: Core\n---\n')
    const contentHash = computeSkillContentHash({
      packageRoot,
      skillDir: 'skills/core',
    })
    const lockPath = join(root, 'intent.lock')
    writeFile(
      lockPath,
      serializeIntentLockfile({
        lockfileVersion: 1,
        sources: [
          {
            kind: 'npm',
            id: 'pkg',
            observedVersion: '1.0.0',
            skills: [{ path: 'skills/core', contentHash }],
          },
        ],
      }),
    )
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
