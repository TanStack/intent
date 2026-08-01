import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInstallCommand } from '../src/commands/install/command.js'
import { readIntentConsumerConfig } from '../src/commands/install/config.js'
import {
  buildIntentSkillGuidanceBlock,
  buildIntentSkillsBlock,
  buildIntentSkillsBlockFromPackages,
  resolveMapTargetPath,
  verifyIntentSkillsBlockFile,
  writeIntentSkillsBlock,
} from '../src/commands/install/guidance.js'
import { readIntentLockfile } from '../src/core/lockfile/lockfile.js'
import { packageVersionToPin } from '../src/shared/command-runner.js'
import type {
  IntentPackage,
  ScanResult,
  SkillEntry,
} from '../src/shared/types.js'

const mapPromptMocks = vi.hoisted(() => ({
  selectClackMapTarget: vi.fn<(root: string) => Promise<string | null>>(),
  selectClackSkills: vi.fn(),
}))

vi.mock('../src/commands/install/prompts.js', async (importOriginal) => ({
  ...(await importOriginal()),
  selectClackMapTarget: mapPromptMocks.selectClackMapTarget,
  selectClackSkills: mapPromptMocks.selectClackSkills,
}))

const tempDirs: Array<string> = []
const originalCwd = process.cwd()
const originalStdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const originalStdoutTTY = Object.getOwnPropertyDescriptor(
  process.stdout,
  'isTTY',
)
const packageJson = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
) as { version: string }
const intentPackagePin = packageVersionToPin(packageJson.version)

afterEach(() => {
  vi.unstubAllEnvs()
  process.chdir(originalCwd)
  if (originalStdinTTY) {
    Object.defineProperty(process.stdin, 'isTTY', originalStdinTTY)
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY
  }
  if (originalStdoutTTY) {
    Object.defineProperty(process.stdout, 'isTTY', originalStdoutTTY)
  } else {
    delete (process.stdout as { isTTY?: boolean }).isTTY
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-install-writer-'))
  tempDirs.push(root)
  return root
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

function bootstrapProject(): string {
  const root = tempRoot()
  writeJson(join(root, 'package.json'), { name: 'app', private: true })
  const packageRoot = join(root, 'node_modules', '@tanstack', 'query')
  writeJson(join(packageRoot, 'package.json'), {
    name: '@tanstack/query',
    version: '5.0.0',
    intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
  })
  const skillRoot = join(packageRoot, 'skills', 'fetching')
  mkdirSync(skillRoot, { recursive: true })
  writeFileSync(
    join(skillRoot, 'SKILL.md'),
    '---\nname: fetching\ndescription: Query fetching patterns\n---\n',
    'utf8',
  )
  return root
}

function writeFetchingSkill(
  root: string,
  frontmatterLines: Array<string>,
): void {
  writeFileSync(
    join(
      root,
      'node_modules',
      '@tanstack',
      'query',
      'skills',
      'fetching',
      'SKILL.md',
    ),
    `---\n${frontmatterLines.join('\n')}\n---\n`,
    'utf8',
  )
}

function bootstrapChdir(): {
  root: string
  packageJsonPath: string
  originalPackageJson: string
} {
  const root = bootstrapProject()
  const packageJsonPath = join(root, 'package.json')
  const originalPackageJson = readFileSync(packageJsonPath, 'utf8')
  process.chdir(root)
  return { root, packageJsonPath, originalPackageJson }
}

function mockBootstrapSelection(target: string | null): void {
  mapPromptMocks.selectClackSkills.mockResolvedValueOnce({
    mode: 'all-found',
  })
  mapPromptMocks.selectClackMapTarget.mockResolvedValueOnce(target)
}

function configuredMapProject(): string {
  const root = tempRoot()
  writeJson(join(root, 'package.json'), {
    name: 'app',
    intent: { skills: ['pkg'], exclude: [] },
  })
  return root
}

function expectNoBootstrapWrites(
  root: string,
  originalPackageJson: string,
): void {
  expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
    originalPackageJson,
  )
  expect(existsSync(join(root, 'intent.lock'))).toBe(false)
  expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  expect(existsSync(join(root, '.intent', 'delivery.json'))).toBe(false)
}

function skill(overrides: Partial<SkillEntry>): SkillEntry {
  return {
    name: 'core',
    path: 'node_modules/pkg/skills/core/SKILL.md',
    description: '',
    ...overrides,
  }
}

function pkg(overrides: Partial<IntentPackage>): IntentPackage {
  return {
    name: 'pkg',
    version: '1.0.0',
    intent: { version: 1, repo: 'test/pkg', docs: 'docs/' },
    skills: [],
    packageRoot: 'node_modules/pkg',
    kind: 'npm',
    source: 'local',
    ...overrides,
  }
}

function scanResult(packages: Array<IntentPackage>): ScanResult {
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
      global: {
        path: null,
        detected: false,
        exists: false,
        scanned: false,
      },
    },
    stats: {
      packageJsonCacheHits: 0,
      packageJsonReadCount: 0,
    },
  }
}

function mappedScanResult(): ScanResult {
  return scanResult([
    pkg({
      skills: [skill({ description: 'Core guidance' })],
    }),
  ])
}

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value,
  })
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value,
  })
}

const exampleBlock = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
    for: "Query data fetching"
<!-- intent-skills:end -->
`

describe('install writer block builder', () => {
  it('builds the default skill loading guidance block', () => {
    const generated = buildIntentSkillGuidanceBlock()

    expect(generated.mappingCount).toBe(0)
    expect(generated.block).toContain('## Intent Skills')
    expect(generated.block).toContain(
      `npx @tanstack/intent@${intentPackagePin} catalog`,
    )
    expect(generated.block).toContain(
      'If an Intent catalog is not already present in this session context',
    )
    expect(generated.block).toContain(
      `npx @tanstack/intent@${intentPackagePin} catalog <package>`,
    )
    expect(generated.block).toContain('If a catalog entry matches the task')
    expect(generated.block).toContain('Do not rerun the catalog for every task')
    expect(generated.block).not.toContain('install --map')
    expect(generated.block).not.toContain('--global')
  })

  it('builds one-off and installed-package loading guidance', () => {
    const generated = buildIntentSkillGuidanceBlock('pnpm')
    const localGenerated = buildIntentSkillGuidanceBlock('pnpm', true)

    expect(generated.block).toContain(
      `pnpm dlx @tanstack/intent@${intentPackagePin} catalog`,
    )
    expect(generated.block).toContain(
      `pnpm dlx @tanstack/intent@${intentPackagePin} load <package>#<skill>`,
    )
    expect(localGenerated.block).toContain('npx @tanstack/intent catalog')
    expect(localGenerated.block).toContain(
      'npx @tanstack/intent load <package>#<skill>',
    )
  })

  it('builds a deterministic compact block', () => {
    const result = scanResult([
      pkg({
        name: '@tanstack/router',
        skills: [
          skill({
            name: 'routing',
            path: 'node_modules/@tanstack/router/skills/routing/SKILL.md',
            description: 'Routing patterns',
          }),
        ],
      }),
      pkg({
        name: '@tanstack/query',
        skills: [
          skill({
            name: 'mutations',
            path: 'node_modules/@tanstack/query/skills/mutations/SKILL.md',
            description: 'Mutation patterns',
          }),
          skill({
            name: 'fetching',
            path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
            description: 'Query data fetching patterns',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(
      buildIntentSkillsBlockFromPackages(
        result.packages,
        result.packageManager,
      ),
    ).toEqual(generated)
    expect(generated.mappingCount).toBe(3)
    expect(generated.block).toBe(`<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
    for: "Query data fetching patterns"
  - id: "@tanstack/query#mutations"
    run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#mutations"
    for: "Mutation patterns"
  - id: "@tanstack/router#routing"
    run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/router#routing"
    for: "Routing patterns"
<!-- intent-skills:end -->
`)
  })

  it('does not emit paths for unsafe skill paths', () => {
    const result = scanResult([
      pkg({
        name: '@tanstack/query',
        skills: [
          skill({
            name: 'global-fetching',
            path: '/home/sarah/.npm-global/lib/node_modules/@tanstack/query/skills/global-fetching/SKILL.md',
            description: 'Global skill',
          }),
          skill({
            name: 'pnpm-fetching',
            path: 'node_modules/.pnpm/@tanstack+query@1.0.0/node_modules/@tanstack/query/skills/pnpm-fetching/SKILL.md',
            description: 'Pnpm store skill',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(generated.mappingCount).toBe(2)
    expect(generated.block).toContain('id: "@tanstack/query#global-fetching"')
    expect(generated.block).toContain('id: "@tanstack/query#pnpm-fetching"')
    expect(generated.block).toContain(
      `run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#global-fetching"`,
    )
    expect(generated.block).not.toContain('/home/sarah')
    expect(generated.block).not.toContain('node_modules/.pnpm')
    expect(generated.block).not.toContain('load:')
  })

  it('maps actionable skills including slash-named sub-skills', () => {
    const result = scanResult([
      pkg({
        name: '@tanstack/query',
        skills: [
          skill({ name: 'core', description: 'Core skill' }),
          skill({ name: 'core/fetching', description: 'Sub-skill' }),
          skill({
            name: 'api',
            description: 'Reference material',
            type: 'reference',
          }),
          skill({
            name: 'publish',
            description: 'Maintainer task',
            type: 'meta',
          }),
          skill({
            name: 'release',
            description: 'Maintainer-only task',
            type: 'maintainer-only',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(generated.mappingCount).toBe(2)
    expect(generated.block).toContain('for: "Core skill"')
    expect(generated.block).toContain('id: "@tanstack/query#core"')
    expect(generated.block).toContain(
      `run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#core"`,
    )
    expect(generated.block).toContain('for: "Sub-skill"')
    expect(generated.block).toContain('id: "@tanstack/query#core/fetching"')
    expect(generated.block).toContain(
      `run: "pnpm dlx @tanstack/intent@${intentPackagePin} load @tanstack/query#core/fetching"`,
    )
    expect(generated.block).not.toContain('Reference material')
    expect(generated.block).not.toContain('Maintainer task')
    expect(generated.block).not.toContain('Maintainer-only task')
  })

  it('escapes generated when and use strings', () => {
    const result = scanResult([
      pkg({
        name: '@tanstack/query',
        skills: [
          skill({
            name: 'quotes',
            path: 'node_modules/@tanstack/query/skills/"quotes"/SKILL.md',
            description: 'Use "quoted" names',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(generated.block).toContain('for: "Use \\"quoted\\" names"')
    expect(generated.block).toContain('id: "@tanstack/query#quotes"')
  })

  it('collapses whitespace in skill descriptions including newlines', () => {
    const result = scanResult([
      pkg({
        name: '@tanstack/query',
        skills: [
          skill({
            name: 'fetching',
            path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
            description: 'Line one\nLine two\ttabbed',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(generated.block).toContain('for: "Line one Line two tabbed"')
  })

  it('uses fallback when description for skills with empty descriptions', () => {
    const result = scanResult([
      pkg({
        name: '@tanstack/query',
        skills: [
          skill({
            name: 'fetching',
            path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
            description: '',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(generated.block).toContain('for: "Use @tanstack/query fetching"')
  })
})

describe('install writer file updates', () => {
  it('resolves nested project map targets', () => {
    const root = tempRoot()

    expect(resolveMapTargetPath(root, '.github/copilot-instructions.md')).toBe(
      join(root, '.github', 'copilot-instructions.md'),
    )
  })

  it.each([
    ['', 'empty'],
    ['/tmp/outside.md', 'native absolute'],
    ['C:\\outside.md', 'Windows absolute'],
    ['../outside.md', 'parent segment'],
    ['notes/../outside.md', 'nested parent segment'],
    ['.git/instructions.md', 'git metadata'],
    ['notes/.git/instructions.md', 'nested git metadata'],
    ['.GIT/instructions.md', 'case-variant git metadata'],
  ])('rejects %s as a map target (%s)', (targetPath) => {
    const root = tempRoot()

    expect(() => resolveMapTargetPath(root, targetPath)).toThrow()
  })

  it('rejects directory and trailing-separator map targets', () => {
    const root = tempRoot()
    mkdirSync(join(root, 'notes'))

    expect(() => resolveMapTargetPath(root, 'notes')).toThrow()
    expect(() => resolveMapTargetPath(root, 'notes/')).toThrow()
  })

  it('rejects map targets through a symlinked parent outside the project', () => {
    const root = tempRoot()
    const outside = tempRoot()
    symlinkSync(outside, join(root, 'linked-notes'), 'dir')

    expect(() =>
      resolveMapTargetPath(root, 'linked-notes/instructions.md'),
    ).toThrow()
  })

  it('rejects an existing map target symlinked outside the project', () => {
    const root = tempRoot()
    const outside = tempRoot()
    const outsideFile = join(outside, 'instructions.md')
    writeFileSync(outsideFile, 'outside\n')
    symlinkSync(outsideFile, join(root, 'instructions.md'), 'file')

    expect(() => resolveMapTargetPath(root, 'instructions.md')).toThrow()
  })

  it('creates AGENTS.md when no managed block exists', () => {
    const root = tempRoot()

    const result = writeIntentSkillsBlock({
      block: exampleBlock,
      mappingCount: 1,
      root,
    })

    expect(result).toEqual({
      mappingCount: 1,
      status: 'created',
      targetPath: join(root, 'AGENTS.md'),
    })
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(exampleBlock)
  })

  it('updates an existing managed block and preserves surrounding content', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    writeFileSync(
      agentsPath,
      `Before
<!-- intent-skills:start -->
old
<!-- intent-skills:end -->
After
`,
    )

    const result = writeIntentSkillsBlock({
      block: exampleBlock,
      mappingCount: 1,
      root,
    })

    expect(result.status).toBe('updated')
    expect(readFileSync(agentsPath, 'utf8')).toBe(`Before
${exampleBlock.trimEnd()}
After
`)
  })

  it('replaces an explicit custom target block exactly once on rerun', () => {
    const root = tempRoot()
    const targetPath = resolveMapTargetPath(root, 'notes/assistant.md')
    const surrounding = 'Project introduction\nProject details\n'
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, surrounding)

    writeIntentSkillsBlock({
      block: exampleBlock,
      mappingCount: 1,
      root,
      targetPath,
    })
    const updatedBlock = exampleBlock.replace(
      'Query data fetching',
      'Query cache management',
    )
    writeIntentSkillsBlock({
      block: updatedBlock,
      mappingCount: 1,
      root,
      targetPath,
    })

    const content = readFileSync(targetPath, 'utf8')
    expect(content.match(/<!-- intent-skills:start -->/g)).toHaveLength(1)
    expect(content).toBe(`${updatedBlock}\n${surrounding}`)
  })

  it('prepends to an existing AGENTS.md without a managed block', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    writeFileSync(agentsPath, 'Existing guidance\n')

    const result = writeIntentSkillsBlock({
      block: exampleBlock,
      mappingCount: 1,
      root,
    })

    expect(result.status).toBe('updated')
    expect(readFileSync(agentsPath, 'utf8')).toBe(
      `${exampleBlock}\nExisting guidance\n`,
    )
  })

  it('updates the existing managed config instead of creating AGENTS.md', () => {
    const root = tempRoot()
    const claudePath = join(root, 'CLAUDE.md')
    writeFileSync(
      claudePath,
      `Intro
<!-- intent-skills:start -->
old
<!-- intent-skills:end -->
`,
    )

    const result = writeIntentSkillsBlock({
      block: exampleBlock,
      mappingCount: 1,
      root,
    })

    expect(result).toEqual({
      mappingCount: 1,
      status: 'updated',
      targetPath: claudePath,
    })
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('rejects malformed managed blocks before writing', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const malformedContent = `Intro
<!-- intent-skills:start -->
old
`
    writeFileSync(agentsPath, malformedContent)

    expect(() =>
      writeIntentSkillsBlock({
        block: exampleBlock,
        mappingCount: 1,
        root,
      }),
    ).toThrow(`Invalid intent-skills block in ${agentsPath}`)
    expect(readFileSync(agentsPath, 'utf8')).toBe(malformedContent)
  })

  it('preserves CRLF newline style when replacing a managed block', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    writeFileSync(
      agentsPath,
      [
        'Before',
        '<!-- intent-skills:start -->',
        'old',
        '<!-- intent-skills:end -->',
        'After',
        '',
      ].join('\r\n'),
    )

    writeIntentSkillsBlock({
      block: exampleBlock,
      mappingCount: 1,
      root,
    })

    const content = readFileSync(agentsPath, 'utf8')
    const expected = [
      'Before',
      ...exampleBlock.trimEnd().split('\n'),
      'After',
      '',
    ].join('\r\n')

    expect(content).toContain('\r\n')
    expect(content.replace(/\r\n/g, '')).not.toContain('\n')
    expect(content).toBe(expected)
  })
})

describe('install writer verification', () => {
  it('accepts a written guidance block', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const generated = buildIntentSkillGuidanceBlock()
    writeFileSync(agentsPath, generated.block)

    expect(
      verifyIntentSkillsBlockFile({
        expectedBlock: generated.block,
        targetPath: agentsPath,
      }),
    ).toEqual({ errors: [], ok: true })
  })

  it.each([
    'intent load @tanstack/query#fetching',
    'npx @tanstack/intent@latest load @tanstack/query#fetching',
    'npx @tanstack/intent@0.4 load @tanstack/query#fetching',
    'npx @tanstack/intent@0.4.0-next.1 load @tanstack/query#fetching',
  ])(
    'accepts a guidance command that extracts its skill use: %s',
    (command) => {
      const root = tempRoot()
      const agentsPath = join(root, 'AGENTS.md')
      const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "${command}"
    for: "Query data fetching"
<!-- intent-skills:end -->
`
      writeFileSync(agentsPath, block)

      expect(
        verifyIntentSkillsBlockFile({
          expectedBlock: block,
          expectedMappingCount: 1,
          targetPath: agentsPath,
        }),
      ).toEqual({ errors: [], ok: true })
    },
  )

  it('accepts a written compact block', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
    for: "Query data fetching"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    expect(
      verifyIntentSkillsBlockFile({
        expectedBlock: block,
        expectedMappingCount: 1,
        targetPath: agentsPath,
      }),
    ).toEqual({ errors: [], ok: true })
  })

  it('rejects when target file does not exist', () => {
    const root = tempRoot()
    const missingPath = join(root, 'AGENTS.md')

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: exampleBlock,
      expectedMappingCount: 1,
      targetPath: missingPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('Agent config file was not created')
  })

  it('rejects missing managed block markers', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    writeFileSync(agentsPath, 'tanstackIntent: []\n')

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: exampleBlock,
      expectedMappingCount: 1,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Missing intent-skills start marker.')
    expect(result.errors).toContain('Missing intent-skills end marker.')
  })

  it('rejects stale managed blocks', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    writeFileSync(
      agentsPath,
      exampleBlock.replace('Query data fetching', 'Query cache management'),
    )

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: exampleBlock,
      expectedMappingCount: 1,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Managed block does not match generated mappings.',
    )
  })

  it('rejects legacy skills lists', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# Skill mappings - load \`use\` with \`npx @tanstack/intent@${intentPackagePin} load <use>\`.
skills:
  - when: "Global query skill"
    load: "/home/sarah/.npm-global/lib/node_modules/@tanstack/query/skills/global/SKILL.md"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: block,
      expectedMappingCount: 2,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Managed block must contain a tanstackIntent list.',
    )
  })

  it('rejects mappings without for', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: block,
      expectedMappingCount: 1,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Each skill mapping must include a non-empty `for` field.',
    )
  })

  it('rejects mappings without id', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - run: "npx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
    for: "Query data fetching"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: block,
      expectedMappingCount: 2,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Each skill mapping must include an `id` field.',
    )
  })

  it('rejects invalid id values', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query"
    run: "npx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
    for: "Query data fetching"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: block,
      expectedMappingCount: 1,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Invalid skill use "@tanstack/query": expected <package>#<skill>.',
    )
  })

  it('rejects mappings whose run command loads a different skill use', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@${intentPackagePin} load @tanstack/router#routing"
    for: "Query data fetching"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: block,
      expectedMappingCount: 1,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Skill mapping `run` must load matching `id` @tanstack/query#fetching.',
    )
  })

  it('rejects mappings with local paths in managed values', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@${intentPackagePin} load @tanstack/query#fetching"
    for: "Edit /Users/sarah/project/src files"
<!-- intent-skills:end -->
`
    writeFileSync(agentsPath, block)

    const result = verifyIntentSkillsBlockFile({
      expectedBlock: block,
      expectedMappingCount: 1,
      targetPath: agentsPath,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Managed block must not include local file paths.',
        'Skill mapping `for` must not include local file paths.',
      ]),
    )
  })
})

describe('install map destination command', () => {
  beforeEach(() => {
    setTTY(true)
  })

  it('asks an agent to pause when trust has not been approved', async () => {
    const { root, originalPackageJson } = bootstrapChdir()
    vi.stubEnv('INTENT_AUDIENCE', 'agent')

    await expect(
      runInstallCommand({ map: true }, () =>
        Promise.resolve(mappedScanResult()),
      ),
    ).rejects.toThrow(
      'Pause and ask the user to run `intent install` interactively to approve skills and choose the delivery target. Do not continue installation automatically.',
    )

    expect(mapPromptMocks.selectClackSkills).not.toHaveBeenCalled()
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('bootstraps trust and writes the selected map without delivery state', async () => {
    const root = bootstrapProject()
    const targetPath = join(root, '.github', 'copilot-instructions.md')
    process.chdir(root)
    mockBootstrapSelection('.github/copilot-instructions.md')

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(scanResult([])),
    )

    expect(
      readIntentConsumerConfig(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ),
    ).toEqual({ skills: ['@tanstack/query'], exclude: [] })
    expect(readIntentLockfile(join(root, 'intent.lock')).status).toBe('found')
    expect(readFileSync(targetPath, 'utf8')).toContain('intent@0.3 catalog')
    expect(existsSync(join(root, '.intent', 'delivery.json'))).toBe(false)
  })

  it('falls through to policed map behavior when the TTY root has no package', async () => {
    const root = tempRoot()
    process.chdir(root)
    const scan = vi.fn(() => Promise.resolve(scanResult([])))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runInstallCommand({ map: true }, scan)

    expect(scan).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('No intent-enabled skills found.')
    expect(mapPromptMocks.selectClackSkills).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'intent.lock'))).toBe(false)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('does not bootstrap without a lock outside a TTY', async () => {
    const { root, originalPackageJson } = bootstrapChdir()
    setTTY(false)
    const scan = vi.fn(() => Promise.resolve(scanResult([])))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runInstallCommand({ map: true }, scan)

    expect(scan).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('No intent-enabled skills found.')
    expect(mapPromptMocks.selectClackSkills).not.toHaveBeenCalled()
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('preserves existing policy without a lock and does not bootstrap', async () => {
    const root = bootstrapProject()
    const packageJsonPath = join(root, 'package.json')
    const originalPackageJson = `{
  "name": "app",
  "intent": {
    "skills": ["@tanstack/query"],
    "exclude": []
  }
}
`
    writeFileSync(packageJsonPath, originalPackageJson)
    process.chdir(root)
    const scan = vi.fn(() => Promise.resolve(scanResult([])))

    await runInstallCommand({ map: true }, scan)

    expect(scan).toHaveBeenCalledOnce()
    expect(mapPromptMocks.selectClackSkills).not.toHaveBeenCalled()
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('writes nothing when bootstrap skill selection is cancelled', async () => {
    const { root, originalPackageJson } = bootstrapChdir()
    mapPromptMocks.selectClackSkills.mockResolvedValueOnce(null)

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(scanResult([])),
    )

    expect(mapPromptMocks.selectClackMapTarget).not.toHaveBeenCalled()
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('writes nothing when bootstrap map destination selection is cancelled', async () => {
    const { root, originalPackageJson } = bootstrapChdir()
    mockBootstrapSelection(null)

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(scanResult([])),
    )

    expect(mapPromptMocks.selectClackMapTarget).toHaveBeenCalledWith(
      process.cwd(),
    )
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('does not prompt or write when bootstrap finds no actionable skills', async () => {
    const { root, originalPackageJson } = bootstrapChdir()
    writeFetchingSkill(root, [
      'name: fetching',
      'description: Query reference',
      'type: reference',
    ])
    const scan = vi.fn(() => Promise.resolve(scanResult([])))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runInstallCommand({ map: true }, scan)

    expect(log).toHaveBeenCalledWith('No intent-enabled skills found.')
    expect(scan).not.toHaveBeenCalled()
    expect(mapPromptMocks.selectClackSkills).not.toHaveBeenCalled()
    expect(mapPromptMocks.selectClackMapTarget).not.toHaveBeenCalled()
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('dry-runs bootstrap map output without writing trust or map files', async () => {
    const { root, originalPackageJson } = bootstrapChdir()
    mockBootstrapSelection('.github/copilot-instructions.md')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runInstallCommand({ dryRun: true, map: true }, () =>
      Promise.resolve(scanResult([])),
    )

    expect(log.mock.calls.flat().join('\n')).toContain(
      'Would write Intent catalog guidance to .github/copilot-instructions.md.',
    )
    expect(log.mock.calls.flat().join('\n')).not.toContain(
      'id: "@tanstack/query#fetching"',
    )
    expectNoBootstrapWrites(root, originalPackageJson)
  })

  it('writes bootstrap artifacts at the workspace root from a package leaf', async () => {
    const root = bootstrapProject()
    const leaf = join(root, 'packages', 'app')
    writeJson(join(root, 'package.json'), {
      name: 'workspace',
      private: true,
      workspaces: ['packages/*'],
    })
    writeJson(join(leaf, 'package.json'), { name: 'app', private: true })
    process.chdir(leaf)
    mockBootstrapSelection('AGENTS.md')

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(scanResult([])),
    )

    expect(
      readIntentConsumerConfig(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ),
    ).toEqual({ skills: ['@tanstack/query'], exclude: [] })
    expect(readIntentLockfile(join(root, 'intent.lock')).status).toBe('found')
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('catalog')
    expect(existsSync(join(leaf, 'intent.lock'))).toBe(false)
    expect(existsSync(join(leaf, 'AGENTS.md'))).toBe(false)

    mapPromptMocks.selectClackMapTarget.mockClear()
    await runInstallCommand({ map: true }, () =>
      Promise.resolve(mappedScanResult()),
    )

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('catalog')
    expect(existsSync(join(leaf, 'AGENTS.md'))).toBe(false)
    expect(mapPromptMocks.selectClackMapTarget).not.toHaveBeenCalled()
  })

  it('targets the current package leaf during fallback', async () => {
    const root = tempRoot()
    const leaf = join(root, 'packages', 'app')
    writeJson(join(root, 'package.json'), {
      name: 'workspace',
      private: true,
      workspaces: ['packages/*'],
      intent: { skills: ['pkg'], exclude: [] },
    })
    writeJson(join(leaf, 'package.json'), { name: 'app', private: true })
    process.chdir(leaf)
    mapPromptMocks.selectClackMapTarget.mockResolvedValueOnce('AGENTS.md')

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(mappedScanResult()),
    )

    expect(mapPromptMocks.selectClackMapTarget).toHaveBeenCalledWith(
      process.cwd(),
    )
    expect(readFileSync(join(leaf, 'AGENTS.md'), 'utf8')).toContain('catalog')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('does not prompt or write when there are no mappings', async () => {
    const root = configuredMapProject()
    process.chdir(root)

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(scanResult([])),
    )

    expect(mapPromptMocks.selectClackMapTarget).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })

  it('updates an existing managed target without prompting', async () => {
    const root = configuredMapProject()
    const targetPath = join(root, 'CLAUDE.md')
    process.chdir(root)
    writeFileSync(targetPath, exampleBlock)

    await runInstallCommand({ map: true }, () =>
      Promise.resolve(mappedScanResult()),
    )

    expect(mapPromptMocks.selectClackMapTarget).not.toHaveBeenCalled()
    expect(readFileSync(targetPath, 'utf8')).toContain('catalog')
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
  })
})
