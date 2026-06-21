import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildIntentSkillGuidanceBlock,
  buildIntentSkillsBlock,
  resolveIntentSkillsBlockTargetPath,
  verifyIntentSkillsBlockFile,
  writeIntentSkillsBlock,
} from '../src/commands/install/guidance.js'
import type {
  IntentPackage,
  ScanResult,
  SkillEntry,
} from '../src/shared/types.js'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-install-writer-'))
  tempDirs.push(root)
  return root
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

const exampleBlock = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/query#fetching"
    for: "Query data fetching"
<!-- intent-skills:end -->
`

describe('install writer block builder', () => {
  it('builds the default skill loading guidance block', () => {
    const generated = buildIntentSkillGuidanceBlock()

    expect(generated.mappingCount).toBe(0)
    expect(generated.block).toContain('## Skill Loading')
    expect(generated.block).toContain('npx @tanstack/intent@latest list')
    expect(generated.block).toContain('If a listed skill matches the task')
    expect(generated.block).toContain('before changing files')
    expect(generated.block).toContain('Monorepos:')
    expect(generated.block).toContain('Multiple matches:')
    expect(generated.block).not.toContain('install --map')
    expect(generated.block).not.toContain('--global')
  })

  it('builds package-manager-specific loading guidance', () => {
    const generated = buildIntentSkillGuidanceBlock('pnpm')

    expect(generated.block).toContain('pnpm dlx @tanstack/intent@latest list')
    expect(generated.block).toContain(
      'pnpm dlx @tanstack/intent@latest load <package>#<skill>',
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

    expect(generated.mappingCount).toBe(3)
    expect(generated.block).toBe(`<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/query#fetching"
    for: "Query data fetching patterns"
  - id: "@tanstack/query#mutations"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/query#mutations"
    for: "Mutation patterns"
  - id: "@tanstack/router#routing"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router#routing"
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
      'run: "pnpm dlx @tanstack/intent@latest load @tanstack/query#global-fetching"',
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
      'run: "pnpm dlx @tanstack/intent@latest load @tanstack/query#core"',
    )
    expect(generated.block).toContain('for: "Sub-skill"')
    expect(generated.block).toContain('id: "@tanstack/query#core/fetching"')
    expect(generated.block).toContain(
      'run: "pnpm dlx @tanstack/intent@latest load @tanstack/query#core/fetching"',
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

  it('resolves the existing managed config as the write target', () => {
    const root = tempRoot()
    const claudePath = join(root, 'CLAUDE.md')
    writeFileSync(claudePath, exampleBlock)

    expect(resolveIntentSkillsBlockTargetPath(root, 1)).toBe(claudePath)
    expect(resolveIntentSkillsBlockTargetPath(root, 0)).toBe(null)
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

  it('accepts a written compact block', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
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
# Skill mappings - load \`use\` with \`npx @tanstack/intent@latest load <use>\`.
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
    run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
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
  - run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
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
    run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
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
    run: "npx @tanstack/intent@latest load @tanstack/router#routing"
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
    run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
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
