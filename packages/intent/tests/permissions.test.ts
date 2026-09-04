import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPermissionPrompts,
  setupInitialPermissions,
} from '../src/commands/install/permissions.js'
import type {
  ClackPermissionRuntime,
  PermissionPromptGroup,
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
  allowAll = false,
  confirmWrite = true,
  selection = [],
}: {
  allowAll?: boolean | null
  confirmWrite?: boolean | null
  selection?: Array<string> | null
} = {}): PermissionPrompts & { groups: Array<PermissionPromptGroup> } {
  const result = {
    groups: [] as Array<PermissionPromptGroup>,
    confirmAllowAll: vi.fn(async () => allowAll),
    selectPermissions: vi.fn(async (groups: Array<PermissionPromptGroup>) => {
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
  permissionPrompts = prompts(),
}: {
  dryRun?: boolean
  exclude?: Array<string>
  permissionPrompts?: PermissionPrompts & {
    groups?: Array<PermissionPromptGroup>
  }
} = {}): Promise<{
  packageJsonPath: string
  permissionPrompts: PermissionPrompts & {
    groups?: Array<PermissionPromptGroup>
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
      scan: () =>
        scan([
          packageCandidate('@scope/npm', 'npm', ['core', 'advanced']),
          packageCandidate('@scope/workspace', 'workspace', ['routing']),
        ]),
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

  it('keeps allow-all separate from grouped selections', async () => {
    const permissionPrompts = prompts({
      allowAll: true,
      selection: ['@scope/npm#core'],
    })
    const { packageJsonPath } = await configure({ permissionPrompts })

    expect(configuredSkills(packageJsonPath)).toEqual(['*'])
    expect(permissionPrompts.selectPermissions).not.toHaveBeenCalled()
  })

  it('constructs package groups with package-wide, exact, and disabled exclusion options', async () => {
    const permissionPrompts = prompts({ selection: [] })
    await configure({
      exclude: ['@scope/npm#advanced', '@scope/workspace'],
      permissionPrompts,
    })

    expect(permissionPrompts.groups).toEqual([
      {
        label: '@scope/npm',
        options: [
          { label: 'All skills', value: '@scope/npm' },
          {
            label: 'advanced',
            value: '@scope/npm#advanced',
            disabled: true,
            hint: 'Excluded by intent.exclude',
          },
          { label: 'core', value: '@scope/npm#core' },
        ],
      },
      {
        label: 'workspace:@scope/workspace',
        options: [
          {
            label: 'All skills',
            value: 'workspace:@scope/workspace',
            disabled: true,
            hint: 'Excluded by intent.exclude',
          },
          {
            label: 'routing',
            value: 'workspace:@scope/workspace#routing',
            disabled: true,
            hint: 'Excluded by intent.exclude',
          },
        ],
      },
    ])
  })

  it.each([
    ['allow-all prompt', prompts({ allowAll: null })],
    ['grouped selection', prompts({ selection: null })],
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

describe('Clack permission adapter', () => {
  it('maps grouped options and prompt defaults to Clack', async () => {
    const runtime = {
      cancel: vi.fn(),
      confirm: vi.fn(async () => false),
      groupMultiselect: vi.fn(async () => ['pkg#core']),
      isCancel: vi.fn(() => false),
    } as unknown as ClackPermissionRuntime
    const permissionPrompts = createPermissionPrompts(runtime)
    const groups: Array<PermissionPromptGroup> = [
      {
        label: 'pkg',
        options: [
          { label: 'All skills', value: 'pkg' },
          {
            label: 'private',
            value: 'pkg#private',
            disabled: true,
            hint: 'Excluded by intent.exclude',
          },
        ],
      },
    ]

    await expect(permissionPrompts.confirmAllowAll()).resolves.toBe(false)
    await expect(permissionPrompts.selectPermissions(groups)).resolves.toEqual([
      'pkg#core',
    ])
    await expect(permissionPrompts.confirmWrite()).resolves.toBe(false)

    expect(runtime.confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Allow all current and future skill sources?',
        initialValue: false,
      }),
    )
    expect(runtime.groupMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select trusted packages and skills',
        options: { pkg: groups[0]!.options },
        required: false,
        selectableGroups: false,
      }),
    )
    expect(runtime.confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Write this permission configuration?',
        initialValue: false,
      }),
    )
  })

  it('maps a Clack cancel symbol to one cancellation message', async () => {
    const canceled = Symbol('cancel')
    const runtime = {
      cancel: vi.fn(),
      confirm: vi.fn(async () => canceled),
      groupMultiselect: vi.fn(),
      isCancel: vi.fn((value) => value === canceled),
    } as unknown as ClackPermissionRuntime
    const permissionPrompts = createPermissionPrompts(runtime)

    await expect(permissionPrompts.confirmAllowAll()).resolves.toBeNull()
    expect(runtime.cancel).toHaveBeenCalledOnce()
    expect(runtime.cancel).toHaveBeenCalledWith(
      'Permissions: canceled.',
      expect.objectContaining({ output: process.stdout }),
    )
  })
})
