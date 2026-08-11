import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanInstallCandidateInventory } from '../src/commands/install/candidate-inventory.js'
import { createIntentFsCache } from '../src/discovery/fs-cache.js'
import { nodeReadFs } from '../src/shared/utils.js'
import type { ReadFs } from '../src/shared/utils.js'

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
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-inventory-test-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('scanInstallCandidateInventory', () => {
  it('returns canonical candidate metadata through the public inventory seam', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      packageManager: 'npm@10.0.0',
      dependencies: { '@scope/pkg': '1.2.3' },
    })
    const packageRoot = join(root, 'node_modules', '@scope', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: '@scope/pkg',
      version: '1.2.3',
      intent: { version: 1, repo: 'scope/pkg', docs: 'docs/' },
    })
    const skillRoot = join(packageRoot, 'skills', 'query', 'cache')
    writeFile(
      join(skillRoot, 'SKILL.md'),
      '---\nname: pinned\ndescription: Pinned hash fixture\n---\n',
    )
    writeFile(join(skillRoot, 'references', 'zeta.md'), 'Zeta\n')
    writeFile(join(skillRoot, 'references', 'alpha.md'), 'Alpha\r\n')

    const result = scanInstallCandidateInventory(root)

    expect(result.sources).toEqual([
      {
        kind: 'npm',
        id: '@scope/pkg',
        observedVersion: '1.2.3',
        packageRoot,
        source: 'local',
        provenance: 'direct',
        permitted: true,
        excluded: false,
        skills: [
          {
            name: 'query/cache',
            description: 'Pinned hash fixture',
            use: '@scope/pkg#query/cache',
            path: 'skills/query/cache',
            contentHash:
              'sha256-985f0fe3329f5eb4cbf3202c9d34da0c53d404292423a15a25d914b7fadc6ce7',
            permitted: true,
            excluded: false,
          },
        ],
      },
    ])
    expect(result.packageManager).toBe('npm')
    expect(result.readFs).toBe(nodeReadFs)
  })

  it('does not create install outputs while scanning candidates', () => {
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
    writeFile(
      join(packageRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: Core\n---\n',
    )

    scanInstallCandidateInventory(root)

    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('returns sources and skills in deterministic canonical order', () => {
    writeJson(join(root, 'package.json'), { name: 'app' })
    for (const [packageName, skillNames] of [
      ['zeta', ['zeta', 'alpha']],
      ['alpha', ['charlie', 'bravo']],
    ] as const) {
      const packageRoot = join(root, 'node_modules', packageName)
      writeJson(join(packageRoot, 'package.json'), {
        name: packageName,
        version: '1.0.0',
        intent: { version: 1, repo: `test/${packageName}`, docs: 'docs/' },
      })
      for (const skillName of skillNames) {
        writeFile(
          join(packageRoot, 'skills', skillName, 'SKILL.md'),
          `---\ndescription: ${skillName}\n---\n`,
        )
      }
    }

    const result = scanInstallCandidateInventory(root)

    expect(
      result.sources.map((source) => ({
        id: source.id,
        paths: source.skills.map((skill) => skill.path),
      })),
    ).toEqual([
      { id: 'alpha', paths: ['skills/bravo', 'skills/charlie'] },
      { id: 'zeta', paths: ['skills/alpha', 'skills/zeta'] },
    ])
  })

  it('keeps npm and workspace sources with the same id distinct', () => {
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

    const result = scanInstallCandidateInventory(root)

    expect(result.warnings).toEqual([
      expect.stringContaining('Found 2 installed variants of shared'),
    ])
    expect(result.conflicts).toEqual([
      expect.objectContaining({ packageName: 'shared' }),
    ])
    expect(
      result.sources.map((source) => ({
        kind: source.kind,
        id: source.id,
        observedVersion: source.observedVersion,
        paths: source.skills.map((skill) => skill.path),
      })),
    ).toEqual([
      {
        kind: 'npm',
        id: 'shared',
        observedVersion: '1.0.0',
        paths: ['skills/npm-skill'],
      },
      {
        kind: 'workspace',
        id: 'shared',
        observedVersion: '2.0.0',
        paths: ['skills/workspace-skill'],
      },
    ])
  })

  it('classifies workspace, direct, and transitive provenance exclusively', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      workspaces: ['packages/*'],
      dependencies: { carrier: '1.0.0' },
      devDependencies: { direct: '1.0.0' },
    })

    const workspaceRoot = join(root, 'packages', 'workspace-source')
    writeJson(join(workspaceRoot, 'package.json'), {
      name: 'workspace-source',
      version: '3.0.0',
      intent: { version: 1, repo: 'test/workspace', docs: 'docs/' },
    })
    writeFile(
      join(workspaceRoot, 'skills', 'workspace', 'SKILL.md'),
      '---\ndescription: Workspace\n---\n',
    )

    const directRoot = join(root, 'node_modules', 'direct')
    writeJson(join(directRoot, 'package.json'), {
      name: 'direct',
      version: '2.0.0',
      intent: { version: 1, repo: 'test/direct', docs: 'docs/' },
    })
    writeFile(
      join(directRoot, 'skills', 'direct', 'SKILL.md'),
      '---\ndescription: Direct\n---\n',
    )

    const carrierRoot = join(root, 'node_modules', 'carrier')
    writeJson(join(carrierRoot, 'package.json'), {
      name: 'carrier',
      version: '1.0.0',
      dependencies: { transitive: '1.0.0' },
    })
    const transitiveRoot = join(carrierRoot, 'node_modules', 'transitive')
    writeJson(join(transitiveRoot, 'package.json'), {
      name: 'transitive',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/transitive', docs: 'docs/' },
    })
    writeFile(
      join(transitiveRoot, 'skills', 'transitive', 'SKILL.md'),
      '---\ndescription: Transitive\n---\n',
    )
    symlinkSync(
      workspaceRoot,
      join(root, 'node_modules', 'workspace-source'),
      'dir',
    )

    const result = scanInstallCandidateInventory(root)

    expect(
      Object.fromEntries(
        result.sources.map((source) => [source.id, source.provenance]),
      ),
    ).toEqual({
      direct: 'direct',
      transitive: 'transitive',
      'workspace-source': 'workspace',
    })
  })

  it('annotates an exact skill selector without filtering sibling skills', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { pkg: '1.0.0' },
      intent: { skills: ['pkg#selected'] },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    for (const skillName of ['selected', 'sibling']) {
      writeFile(
        join(packageRoot, 'skills', skillName, 'SKILL.md'),
        `---\ndescription: ${skillName}\n---\n`,
      )
    }

    const result = scanInstallCandidateInventory(root)

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({ permitted: true })
    expect(
      result.sources[0]!.skills.map((skill) => ({
        name: skill.name,
        permitted: skill.permitted,
      })),
    ).toEqual([
      { name: 'selected', permitted: true },
      { name: 'sibling', permitted: false },
    ])
  })

  it('uses exact-first skill policy when aliases collide', () => {
    for (const [fixtureName, selector, expected] of [
      [
        'canonical',
        'pkg#pkg/foo',
        [
          { name: 'foo', permitted: false },
          { name: 'pkg/foo', permitted: true },
        ],
      ],
      [
        'short',
        'pkg#foo',
        [
          { name: 'foo', permitted: true },
          { name: 'pkg/foo', permitted: false },
        ],
      ],
    ] as const) {
      const fixtureRoot = join(root, fixtureName)
      writeJson(join(fixtureRoot, 'package.json'), {
        name: 'app',
        dependencies: { pkg: '1.0.0' },
        intent: { skills: [selector] },
      })
      const packageRoot = join(fixtureRoot, 'node_modules', 'pkg')
      writeJson(join(packageRoot, 'package.json'), {
        name: 'pkg',
        version: '1.0.0',
        intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
      })
      for (const skillName of ['foo', 'pkg/foo']) {
        writeFile(
          join(packageRoot, 'skills', skillName, 'SKILL.md'),
          `---\ndescription: ${skillName}\n---\n`,
        )
      }

      const result = scanInstallCandidateInventory(fixtureRoot)

      expect(
        result.sources[0]!.skills.map((skill) => ({
          name: skill.name,
          permitted: skill.permitted,
        })),
      ).toEqual(expected)
    }
  })

  it('does not permit a candidate with a source-kind mismatch', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { pkg: '1.0.0' },
      intent: { skills: ['workspace:pkg'] },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    writeFile(
      join(packageRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: Core\n---\n',
    )

    const result = scanInstallCandidateInventory(root)

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      kind: 'npm',
      permitted: false,
      skills: [{ name: 'core', permitted: false }],
    })
  })

  it('preserves source and skill metadata with canonical identity fields', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      peerDependencies: { pkg: '4.5.6-beta.1' },
    })
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '4.5.6-beta.1',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    writeFile(
      join(packageRoot, 'skills', 'typed', 'SKILL.md'),
      '---\ndescription: Typed workflow\ntype: core\nframework: React\n---\n\nContent.\n',
    )

    const result = scanInstallCandidateInventory(root)

    expect(result.sources[0]).toMatchObject({
      kind: 'npm',
      id: 'pkg',
      observedVersion: '4.5.6-beta.1',
      packageRoot,
      source: 'local',
      provenance: 'direct',
      skills: [
        {
          name: 'typed',
          description: 'Typed workflow',
          type: 'core',
          framework: 'React',
          use: 'pkg#typed',
          path: 'skills/typed',
          contentHash: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
        },
      ],
    })
  })

  it('annotates package and skill excludes without filtering either source kind', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      workspaces: ['packages/*'],
      dependencies: {
        'package-carrier': '1.0.0',
        'skill-carrier': '1.0.0',
      },
      intent: {
        exclude: ['shared-package', 'shared-skill#blocked'],
      },
    })

    const writeSourcePackage = (
      packageRoot: string,
      packageName: string,
      skillNames: Array<string>,
    ): void => {
      writeJson(join(packageRoot, 'package.json'), {
        name: packageName,
        version: '1.0.0',
        intent: { version: 1, repo: `test/${packageName}`, docs: 'docs/' },
      })
      for (const skillName of skillNames) {
        writeFile(
          join(packageRoot, 'skills', skillName, 'SKILL.md'),
          `---\ndescription: ${skillName}\n---\n`,
        )
      }
    }

    for (const [packageName, skillNames, carrierName] of [
      ['shared-package', ['only'], 'package-carrier'],
      ['shared-skill', ['blocked', 'kept'], 'skill-carrier'],
    ] as const) {
      const workspaceRoot = join(root, 'packages', packageName)
      writeSourcePackage(workspaceRoot, packageName, [...skillNames])

      const carrierRoot = join(root, 'node_modules', carrierName)
      writeJson(join(carrierRoot, 'package.json'), {
        name: carrierName,
        version: '1.0.0',
        dependencies: { [packageName]: '1.0.0' },
      })
      writeSourcePackage(
        join(carrierRoot, 'node_modules', packageName),
        packageName,
        [...skillNames],
      )
      symlinkSync(workspaceRoot, join(root, 'node_modules', packageName), 'dir')
    }

    const result = scanInstallCandidateInventory(root)
    const packageExcluded = result.sources.filter(
      (source) => source.id === 'shared-package',
    )
    const skillExcluded = result.sources.filter(
      (source) => source.id === 'shared-skill',
    )

    expect(packageExcluded).toHaveLength(2)
    expect(packageExcluded.map((source) => source.kind)).toEqual([
      'npm',
      'workspace',
    ])
    expect(
      packageExcluded.every(
        (source) => source.excluded && source.skills[0]!.excluded,
      ),
    ).toBe(true)
    expect(skillExcluded).toHaveLength(2)
    expect(skillExcluded.map((source) => source.kind)).toEqual([
      'npm',
      'workspace',
    ])
    expect(
      skillExcluded.map((source) => ({
        packageExcluded: source.excluded,
        skills: source.skills.map((skill) => ({
          name: skill.name,
          excluded: skill.excluded,
        })),
      })),
    ).toEqual([
      {
        packageExcluded: false,
        skills: [
          { name: 'blocked', excluded: true },
          { name: 'kept', excluded: false },
        ],
      },
      {
        packageExcluded: false,
        skills: [
          { name: 'blocked', excluded: true },
          { name: 'kept', excluded: false },
        ],
      },
    ])
  })

  it('uses and returns the scanner active ReadFs for hashing', () => {
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
    writeFile(
      join(packageRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: Core\n---\n',
    )
    const calls = { opendir: 0 }
    const activeFs: ReadFs = {
      ...nodeReadFs,
      opendirSync: ((...args: Array<unknown>) => {
        calls.opendir += 1
        return Reflect.apply(opendirSync, undefined, args)
      }) as ReadFs['opendirSync'],
    }
    const fsCache = createIntentFsCache()
    fsCache.useFs(activeFs)
    const scanOptions = { scope: 'local' as const, fsCache }

    const result = scanInstallCandidateInventory(root, { scanOptions })

    expect(result.readFs).toBe(activeFs)
    expect(calls.opendir).toBeGreaterThan(0)
    expect(result.sources[0]!.skills[0]!.contentHash).toMatch(
      /^sha256-[0-9a-f]{64}$/,
    )
  })

  it('treats an invalid root manifest as no proven direct dependencies', () => {
    writeFile(join(root, 'package.json'), '{ invalid json')
    const packageRoot = join(root, 'node_modules', 'pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    })
    writeFile(
      join(packageRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: Core\n---\n',
    )

    const result = scanInstallCandidateInventory(root)

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      id: 'pkg',
      provenance: 'transitive',
    })
  })

  it('classifies a declared global npm candidate as transitive', () => {
    writeJson(join(root, 'package.json'), {
      name: 'app',
      dependencies: { 'global-pkg': '1.0.0' },
    })
    const globalRoot = realpathSync(
      mkdtempSync(join(tmpdir(), 'intent-inventory-global-test-')),
    )
    const previousGlobalNodeModules = process.env.INTENT_GLOBAL_NODE_MODULES
    process.env.INTENT_GLOBAL_NODE_MODULES = globalRoot
    const packageRoot = join(globalRoot, 'global-pkg')
    writeJson(join(packageRoot, 'package.json'), {
      name: 'global-pkg',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/global', docs: 'docs/' },
    })
    writeFile(
      join(packageRoot, 'skills', 'core', 'SKILL.md'),
      '---\ndescription: Global core\n---\n',
    )

    try {
      const result = scanInstallCandidateInventory(root, {
        scanOptions: { includeGlobal: true },
      })

      expect(result.sources).toHaveLength(1)
      expect(result.sources[0]).toMatchObject({
        id: 'global-pkg',
        source: 'global',
        provenance: 'transitive',
      })
    } finally {
      rmSync(globalRoot, { recursive: true, force: true })
      if (previousGlobalNodeModules === undefined) {
        delete process.env.INTENT_GLOBAL_NODE_MODULES
      } else {
        process.env.INTENT_GLOBAL_NODE_MODULES = previousGlobalNodeModules
      }
    }
  })
})
