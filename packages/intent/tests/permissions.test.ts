import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
