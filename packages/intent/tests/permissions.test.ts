import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as clack from '@clack/prompts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileExcludePatterns } from '../src/core/excludes.js'
import { createPermissionPrompts } from '../src/commands/install/permission-prompts.js'
import {
  applySourcePolicy,
  isSourcePermitted,
  readSkillSourcesConfig,
} from '../src/core/source-policy.js'
import { setupInitialPermissions } from '../src/commands/install/permissions.js'
import { ALLOW_ALL_NOTICE } from '../src/shared/cli-output.js'
import type {
  PermissionPackage,
  PermissionPrompts,
} from '../src/commands/install/permissions.js'
import type { IntentPackage, ScanResult } from '../src/shared/types.js'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function packageCandidate(
  name: string,
  kind: IntentPackage['kind'],
  skills: Array<string>,
): IntentPackage {
  return {
    name,
    version: '1.0.0',
    intent: { version: 1, repo: `test/${name}`, docs: 'docs/' },
    skills: skills.map((skill) => ({
      name: skill,
      path: `node_modules/${name}/skills/${skill}/SKILL.md`,
      description: `${skill} guidance`,
    })),
    packageRoot: `node_modules/${name}`,
    kind,
    source: 'local',
  }
}

function scan(packages: Array<IntentPackage>): ScanResult {
  return {
    packageManager: 'pnpm',
    packages,
    warnings: [],
    notices: [],
    conflicts: [],
    nodeModules: {
      local: {
        path: 'node_modules',
        detected: true,
        exists: true,
        scanned: true,
      },
      global: { path: null, detected: false, exists: false, scanned: false },
    },
    stats: { packageJsonCacheHits: 0, packageJsonReadCount: 0 },
  }
}

function prompts({
  confirmWrite = true,
  selection = [],
}: {
  confirmWrite?: boolean | null
  selection?: Array<string> | null
} = {}): PermissionPrompts & { groups: Array<PermissionPackage> } {
  const result = {
    groups: [] as Array<PermissionPackage>,
    selectPermissions: vi.fn(async (groups: Array<PermissionPackage>) => {
      result.groups = groups
      return selection
    }),
    reviewPermissions: vi.fn((_groups, selection) =>
      Promise.resolve(selection),
    ),
    editPermissions: vi.fn((_groups, selection) => Promise.resolve(selection)),
    confirmWrite: vi.fn(async () => confirmWrite),
  }
  return result
}

async function configure({
  dryRun = false,
  exclude = [],
  packages = [
    packageCandidate('@scope/npm', 'npm', ['core', 'advanced']),
    packageCandidate('@scope/workspace', 'workspace', ['routing']),
  ],
  permissionPrompts = prompts(),
}: {
  dryRun?: boolean
  exclude?: Array<string>
  packages?: Array<IntentPackage>
  permissionPrompts?: PermissionPrompts & {
    groups?: Array<PermissionPackage>
  }
} = {}): Promise<{
  packageJsonPath: string
  permissionPrompts: PermissionPrompts & {
    groups?: Array<PermissionPackage>
  }
  result: Awaited<ReturnType<typeof setupInitialPermissions>>
}> {
  const root = mkdtempSync(join(tmpdir(), 'intent-permissions-'))
  tempDirs.push(root)
  const packageJsonPath = join(root, 'package.json')
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify({ name: 'app', intent: { exclude } }, null, 2)}\n`,
  )

  const result = await setupInitialPermissions({
    dryRun,
    root,
    runtime: {
      prompts: permissionPrompts,
      scan: () => scan(packages),
    },
  })

  return { packageJsonPath, permissionPrompts, result }
}

function configuredSkills(packageJsonPath: string): Array<string> | undefined {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    intent?: { skills?: Array<string> }
  }
  return pkg.intent?.skills
}

describe('interactive permission selection', () => {
  it('keeps large discovery output compact before package selection', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const packages = Array.from({ length: 14 }, (_, index) =>
      packageCandidate(
        `package-${index}`,
        'npm',
        Array.from(
          { length: index === 13 ? 4 : 6 },
          (_, skill) => `skill-${skill}`,
        ),
      ),
    )
    for (const pkg of packages) {
      for (const skill of pkg.skills)
        skill.description = 'Long agent routing description. '.repeat(30)
    }
    try {
      await configure({
        packages,
        permissionPrompts: prompts({ selection: null }),
      })
      const text = output.mock.calls.flat().join('\n')
      expect(text).toContain('Found 82 skills in 14 packages.')
      expect(
        text.split('Skills can change when dependencies update.'),
      ).toHaveLength(2)
      expect(text).not.toContain('Long agent routing description')
      expect(text.length).toBeLessThan(500)
    } finally {
      output.mockRestore()
    }
  })
  it('passes descriptions and versions to the picker without printing them', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const permissionPrompts = prompts({ selection: null })
    try {
      await configure({ permissionPrompts })
      expect(permissionPrompts.groups[0]).toMatchObject({
        id: '@scope/npm',
        version: '1.0.0',
        skills: expect.arrayContaining([
          expect.objectContaining({ description: 'core guidance' }),
        ]),
      })
      expect(output.mock.calls.flat().join('\n')).not.toContain('core guidance')
    } finally {
      output.mockRestore()
    }
  })

  it('saves enable-all as a compact rule covering later packages and skills', async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce('all')
      .mockResolvedValueOnce('save')
    const { packageJsonPath } = await configure({
      permissionPrompts: createPermissionPrompts({
        ...clack,
        select,
      }),
    })
    expect(configuredSkills(packageJsonPath)).toEqual(['*'])
    const policy = readSkillSourcesConfig(dirname(packageJsonPath))
    expect(isSourcePermitted(policy, '@scope/npm', 'npm', 'core')).toBe(true)
    expect(isSourcePermitted(policy, '@scope/npm', 'npm', 'added-later')).toBe(
      true,
    )
    expect(isSourcePermitted(policy, '@scope/new', 'npm', 'core')).toBe(true)
    expect(
      isSourcePermitted(policy, '@scope/workspace', 'workspace', 'routing'),
    ).toBe(true)
    expect(
      isSourcePermitted(policy, '@scope/workspace', 'npm', 'routing'),
    ).toBe(true)
    expect(select).toHaveBeenCalledTimes(2)
  })

  it.each(['@scope/npm', '@scope/*', '*'])(
    'reviews %s and saves exclusions without expanding the rule',
    async (rule) => {
      const select = vi
        .fn()
        .mockResolvedValueOnce('packages')
        .mockResolvedValueOnce('review')
        .mockResolvedValueOnce('save')
      const multiselect = vi
        .fn()
        .mockResolvedValueOnce([rule])
        .mockResolvedValueOnce(['@scope/npm'])
        .mockResolvedValueOnce([])
      const { packageJsonPath } = await configure({
        exclude: ['@scope/npm#advanced'],
        permissionPrompts: createPermissionPrompts({
          ...clack,
          select,
          autocompleteMultiselect: multiselect,
        }),
      })
      const intent = JSON.parse(readFileSync(packageJsonPath, 'utf8')).intent
      expect(intent.skills).toEqual([rule])
      expect(intent.exclude).toContain('@scope/npm#advanced')
      expect(intent.exclude).toContain('@scope/npm#core')
      const future = applySourcePolicy(
        scan([
          packageCandidate('@scope/npm', 'npm', [
            'core',
            'advanced',
            'added-later',
          ]),
          packageCandidate('@scope/new', 'npm', ['core']),
          packageCandidate('@else/pkg', 'npm', ['core']),
        ]),
        {
          config: readSkillSourcesConfig(dirname(packageJsonPath)),
          excludeMatchers: compileExcludePatterns(intent.exclude),
        },
      )
      expect(future.packages[0]?.skills.map((skill) => skill.name)).toEqual([
        'added-later',
      ])
      expect(future.packages.some((pkg) => pkg.name === '@scope/new')).toBe(
        rule !== '@scope/npm',
      )
      expect(future.packages.some((pkg) => pkg.name === '@else/pkg')).toBe(
        rule === '*',
      )
      expect(select).toHaveBeenCalledTimes(3)
    },
  )

  it.each(['cancel', 'dry-run'])(
    'does not persist reviewed exclusions on %s',
    async (action) => {
      const initial = prompts({
        selection: ['@scope/npm'],
        confirmWrite: false,
      })
      vi.mocked(initial.confirmWrite)
        .mockResolvedValueOnce('review')
        .mockResolvedValueOnce(false)
      vi.mocked(initial.reviewPermissions).mockResolvedValue({
        skills: ['@scope/npm'],
        exclude: ['@scope/npm#core'],
      })
      const { packageJsonPath } = await configure({
        dryRun: action === 'dry-run',
        permissionPrompts: initial,
      })
      const intent = JSON.parse(readFileSync(packageJsonPath, 'utf8')).intent
      expect(intent.skills).toBeUndefined()
      expect(intent.exclude).toEqual([])
    },
  )

  it('preserves inherited exclusions while saving new exceptions locally', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-permissions-inherited-'))
    tempDirs.push(root)
    const child = join(root, 'packages', 'app')
    mkdirSync(child, { recursive: true })
    const rootSource = JSON.stringify({
      name: 'root',
      workspaces: ['packages/*'],
      intent: { exclude: ['@scope/npm#advanced'] },
    })
    writeFileSync(join(root, 'package.json'), rootSource)
    writeFileSync(join(child, 'package.json'), JSON.stringify({ name: 'app' }))
    const runtime = createPermissionPrompts({
      ...clack,
      select: vi
        .fn()
        .mockResolvedValueOnce('all')
        .mockResolvedValueOnce('review')
        .mockResolvedValueOnce('save'),
      autocompleteMultiselect: vi
        .fn()
        .mockResolvedValueOnce(['@scope/npm'])
        .mockResolvedValueOnce([]),
    })
    await setupInitialPermissions({
      root: child,
      runtime: {
        prompts: runtime,
        scan: () =>
          scan([packageCandidate('@scope/npm', 'npm', ['core', 'advanced'])]),
      },
    })
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(rootSource)
    expect(
      JSON.parse(readFileSync(join(child, 'package.json'), 'utf8')).intent,
    ).toEqual({ skills: ['*'], exclude: ['@scope/npm#core'] })
  })

  it('counts effective skills under a scope rule and keeps large previews bounded', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await configure({
        exclude: ['@scope/npm#advanced'],
        permissionPrompts: prompts({ selection: ['@scope/*'] }),
      })
      expect(output.mock.calls.flat().join('\n')).toContain(
        'Selected: 1 skill from 1 package currently available.',
      )
      output.mockClear()
      const skills = Array.from({ length: 82 }, (_, i) => `skill-${i}`)
      await configure({
        packages: [packageCandidate('pkg', 'npm', skills)],
        permissionPrompts: prompts({
          selection: skills.map((skill) => `pkg#${skill}`),
        }),
      })
      const text = output.mock.calls.flat().join('\n')
      expect(text).toContain(
        'Selected: 82 skills from 1 package currently available.',
      )
      expect(text).toContain('(+76 more)')
      expect(text.length).toBeLessThan(1000)
    } finally {
      output.mockRestore()
    }
  })

  it('explicitly confirms disabling all skills after an empty selection', async () => {
    const permissionPrompts = prompts({ selection: [] })
    await configure({ permissionPrompts })
    expect(permissionPrompts.confirmWrite).toHaveBeenCalledWith(true)
  })

  it.each([
    ['no discovered skills', [], []],
    [
      'all skills excluded',
      [packageCandidate('pkg', 'npm', ['blocked'])],
      ['pkg#blocked'],
    ],
  ])(
    'leaves first-run setup available with %s',
    async (_label, packages, exclude) => {
      const permissionPrompts = prompts()
      const { packageJsonPath, result } = await configure({
        packages,
        exclude,
        permissionPrompts,
      })

      expect(result).toEqual({ status: 'unavailable' })
      expect(configuredSkills(packageJsonPath)).toBeUndefined()
      expect(permissionPrompts.selectPermissions).not.toHaveBeenCalled()
      expect(permissionPrompts.confirmWrite).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['deny all', [], []],
    [
      'scope plus package',
      ['@scope/*', '@scope/npm', '@scope/npm#core'],
      ['@scope/*'],
    ],
    ['whole package', ['@scope/npm'], ['@scope/npm']],
    [
      'separate kinds',
      ['@scope/*', 'workspace:@scope/workspace'],
      ['@scope/*', 'workspace:@scope/workspace'],
    ],
    [
      'no implicit scope',
      ['@scope/npm', '@scope/second'],
      ['@scope/npm', '@scope/second'],
    ],
    ['exact only', ['@scope/npm#core'], ['@scope/npm#core']],
    [
      'package plus child',
      ['@scope/npm#advanced', '@scope/npm', '@scope/npm#core'],
      ['@scope/npm'],
    ],
    [
      'npm and workspace selectors',
      ['workspace:@scope/workspace#routing', '@scope/npm#advanced'],
      ['@scope/npm#advanced', 'workspace:@scope/workspace#routing'],
    ],
  ])('normalizes %s selection', async (_label, selection, expected) => {
    const { packageJsonPath } = await configure({
      permissionPrompts: prompts({ selection }),
    })

    expect(configuredSkills(packageJsonPath)).toEqual(expected)
  })

  it('writes an explicitly selected allow-all policy', async () => {
    const { packageJsonPath } = await configure({
      permissionPrompts: prompts({ selection: ['*'] }),
    })
    expect(configuredSkills(packageJsonPath)).toEqual(['*'])
  })

  it('prints the allow-all notice before final confirmation', async () => {
    const events: Array<string> = []
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((message) => {
        events.push(String(message))
      })
    const permissionPrompts = prompts({ selection: ['*'] })
    vi.mocked(permissionPrompts.confirmWrite).mockImplementation(() => {
      events.push('confirm-write')
      return Promise.resolve(false)
    })

    try {
      await configure({ permissionPrompts })
    } finally {
      errorSpy.mockRestore()
    }

    expect(events).toContain(`  ℹ ${ALLOW_ALL_NOTICE}`)
    expect(events.indexOf(`  ℹ ${ALLOW_ALL_NOTICE}`)).toBeLessThan(
      events.indexOf('confirm-write'),
    )
  })

  it('prints the allow-all notice during dry-run', async () => {
    const errors: Array<string> = []
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((message) => {
        errors.push(String(message))
      })

    try {
      await configure({
        dryRun: true,
        permissionPrompts: prompts({ selection: ['*'] }),
      })
    } finally {
      errorSpy.mockRestore()
    }

    expect(errors).toContain(`  ℹ ${ALLOW_ALL_NOTICE}`)
  })

  it('preserves package identity, metadata, and exclusions for inspection', async () => {
    const permissionPrompts = prompts()
    await configure({
      exclude: ['@scope/npm#advanced', '@scope/workspace'],
      permissionPrompts,
    })
    expect(permissionPrompts.groups).toEqual([
      {
        id: '@scope/npm',
        version: '1.0.0',
        skills: [
          {
            id: '@scope/npm#advanced',
            name: 'advanced',
            description: 'advanced guidance',
            excluded: true,
          },
          {
            id: '@scope/npm#core',
            name: 'core',
            description: 'core guidance',
            excluded: false,
          },
        ],
      },
      {
        id: 'workspace:@scope/workspace',
        version: '1.0.0',
        skills: [
          {
            id: 'workspace:@scope/workspace#routing',
            name: 'routing',
            description: 'routing guidance',
            excluded: true,
          },
        ],
      },
    ])
  })

  it.each([
    ['package selection', prompts({ selection: null })],
    ['write confirmation', prompts({ selection: [], confirmWrite: null })],
    ['declined write', prompts({ selection: [], confirmWrite: false })],
  ])(
    'cancels once without writing at the %s',
    async (_label, permissionPrompts) => {
      const { packageJsonPath, result } = await configure({ permissionPrompts })

      expect(result).toEqual({ status: 'canceled' })
      expect(configuredSkills(packageJsonPath)).toBeUndefined()
    },
  )

  it('does not ask for final confirmation or write during dry-run', async () => {
    const permissionPrompts = prompts({ selection: ['@scope/npm#core'] })
    const { packageJsonPath, result } = await configure({
      dryRun: true,
      permissionPrompts,
    })

    expect(result).toEqual({ packageJsonPath, status: 'unchanged' })
    expect(permissionPrompts.confirmWrite).not.toHaveBeenCalled()
    expect(configuredSkills(packageJsonPath)).toBeUndefined()
  })
})

describe('existing permission setup', () => {
  it.each(
    [[], ['*', 'missing'], ['missing#old', '@scope/*', 'workspace:pkg']].map(
      (skills) => ({ skills }),
    ),
  )('preserves unchanged rules and formatting for %j', async ({ skills }) => {
    const root = mkdtempSync(join(tmpdir(), 'intent-review-policy-'))
    tempDirs.push(root)
    const packageJsonPath = join(root, 'package.json')
    const source = JSON.stringify({ name: 'app', intent: { skills } }) + '\n'
    writeFileSync(packageJsonPath, source)
    const discover = vi.fn(() => scan([]))
    const result = await setupInitialPermissions({
      root,
      review: true,
      runtime: { prompts: prompts(), scan: discover },
    })
    expect(result).toEqual({
      packageJsonPath,
      status: 'unchanged',
      available: { skills: 0, packages: 0 },
    })
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(source)
    expect(discover).toHaveBeenCalledOnce()
  })

  it('retains inherited permissions until an explicitly confirmed local override', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-review-workspace-'))
    tempDirs.push(root)
    const child = join(root, 'packages', 'app')
    mkdirSync(child, { recursive: true })
    const parentPath = join(root, 'package.json')
    const parent = JSON.stringify({
      name: 'repo',
      workspaces: ['packages/*'],
      intent: { skills: ['pkg'], exclude: ['pkg#private'] },
    })
    writeFileSync(parentPath, parent)
    const childPath = join(child, 'package.json')
    const childSource = '{"name":"app"}\n'
    writeFileSync(childPath, childSource)
    const permissionPrompts = prompts()
    const runtime = {
      prompts: permissionPrompts,
      scan: () => scan([packageCandidate('pkg', 'npm', ['core', 'private'])]),
    }
    const unchanged = await setupInitialPermissions({
      root: child,
      review: true,
      runtime,
    })
    expect(unchanged.status).toBe('unchanged')
    expect(readFileSync(childPath, 'utf8')).toBe(childSource)
    expect(permissionPrompts.editPermissions).toHaveBeenCalledWith(
      expect.any(Array),
      { skills: ['pkg'], exclude: [] },
    )
    vi.mocked(permissionPrompts.editPermissions).mockResolvedValue({
      skills: ['*'],
      exclude: [],
    })
    const changed = await setupInitialPermissions({
      root: child,
      review: true,
      runtime,
    })
    expect(changed).toMatchObject({
      status: 'updated',
      available: { skills: 1, packages: 1 },
    })
    expect(JSON.parse(readFileSync(childPath, 'utf8')).intent.skills).toEqual([
      '*',
    ])
    expect(readFileSync(parentPath, 'utf8')).toBe(parent)
  })

  it.each(['edit', 'confirm'])(
    'rejects local policy changed during %s without overwriting it',
    async (stage) => {
      const root = mkdtempSync(join(tmpdir(), 'intent-review-race-'))
      tempDirs.push(root)
      const packageJsonPath = join(root, 'package.json')
      writeFileSync(
        packageJsonPath,
        '{"name":"app","intent":{"skills":["pkg"]}}',
      )
      const replacement =
        '{"name":"app","intent":{"skills":[],"exclude":["pkg"]}}'
      const permissionPrompts = prompts()
      vi.mocked(permissionPrompts.editPermissions).mockImplementation(
        async () => {
          if (stage === 'edit') writeFileSync(packageJsonPath, replacement)
          return { skills: ['*'], exclude: [] }
        },
      )
      vi.mocked(permissionPrompts.confirmWrite).mockImplementation(async () => {
        if (stage === 'confirm') writeFileSync(packageJsonPath, replacement)
        return true
      })
      await expect(
        setupInitialPermissions({
          root,
          review: true,
          runtime: { prompts: permissionPrompts, scan: () => scan([]) },
        }),
      ).rejects.toThrow('policy changed during permission review')
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(replacement)
    },
  )

  it('rejects an inherited exclusion change during confirmation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-review-exclusion-race-'))
    tempDirs.push(root)
    const child = join(root, 'packages', 'app')
    mkdirSync(child, { recursive: true })
    const parentPath = join(root, 'package.json')
    writeFileSync(
      parentPath,
      JSON.stringify({
        name: 'repo',
        workspaces: ['packages/*'],
        intent: { exclude: [] },
      }),
    )
    const childPath = join(child, 'package.json')
    const source = '{"name":"app","intent":{"skills":["pkg"]}}'
    writeFileSync(childPath, source)
    const permissionPrompts = prompts()
    vi.mocked(permissionPrompts.editPermissions).mockResolvedValue({
      skills: ['*'],
      exclude: [],
    })
    vi.mocked(permissionPrompts.confirmWrite).mockImplementation(async () => {
      writeFileSync(
        parentPath,
        JSON.stringify({
          name: 'repo',
          workspaces: ['packages/*'],
          intent: { exclude: ['pkg'] },
        }),
      )
      return true
    })
    await expect(
      setupInitialPermissions({
        root: child,
        review: true,
        runtime: { prompts: permissionPrompts, scan: () => scan([]) },
      }),
    ).rejects.toThrow('policy changed during permission review')
    expect(readFileSync(childPath, 'utf8')).toBe(source)
  })
})
