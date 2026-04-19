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
  buildIntentSkillsBlock,
  resolveIntentSkillsBlockTargetPath,
  verifyIntentSkillsBlockFile,
  writeIntentSkillsBlock,
} from '../src/commands/install-writer.js'
import type { IntentPackage, ScanResult, SkillEntry } from '../src/types.js'

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
    source: 'local',
    ...overrides,
  }
}

function scanResult(packages: Array<IntentPackage>): ScanResult {
  return {
    packageManager: 'pnpm',
    packages,
    warnings: [],
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
  }
}

const exampleBlock = `<!-- intent-skills:start -->
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
skills:
  - when: "Query data fetching"
    use: "@tanstack/query#fetching"
<!-- intent-skills:end -->
`

describe('install writer block builder', () => {
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
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
skills:
  - when: "Query data fetching patterns"
    use: "@tanstack/query#fetching"
  - when: "Mutation patterns"
    use: "@tanstack/query#mutations"
  - when: "Routing patterns"
    use: "@tanstack/router#routing"
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
    expect(generated.block).toContain('use: "@tanstack/query#global-fetching"')
    expect(generated.block).toContain('use: "@tanstack/query#pnpm-fetching"')
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
    expect(generated.block).toContain('when: "Core skill"')
    expect(generated.block).toContain('use: "@tanstack/query#core"')
    expect(generated.block).toContain('when: "Sub-skill"')
    expect(generated.block).toContain('use: "@tanstack/query#core/fetching"')
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

    expect(generated.block).toContain('when: "Use \\"quoted\\" names"')
    expect(generated.block).toContain('use: "@tanstack/query#quotes"')
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

    expect(generated.block).toContain('when: "Line one Line two tabbed"')
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

    expect(generated.block).toContain('when: "Use @tanstack/query fetching"')
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

  it('appends to an existing AGENTS.md without a managed block', () => {
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
      `Existing guidance\n${exampleBlock}`,
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
  it('accepts a written compact block', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
skills:
  - when: "Query data fetching"
    use: "@tanstack/query#fetching"
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
    writeFileSync(agentsPath, 'skills: []\n')

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

  it('rejects legacy load paths', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
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
      'Skill mappings must use compact `use` entries, not `load`.',
    )
    expect(result.errors).toContain(
      'Each skill mapping must include a `use` field.',
    )
  })

  it('rejects mappings without when', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
skills:
  - use: "@tanstack/query#fetching"
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
      'Each skill mapping must include a non-empty `when` field.',
    )
  })

  it('rejects mappings without use', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
skills:
  - when: "Query data fetching"
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
      'Each skill mapping must include a `use` field.',
    )
  })

  it('rejects invalid use values', () => {
    const root = tempRoot()
    const agentsPath = join(root, 'AGENTS.md')
    const block = `<!-- intent-skills:start -->
# Skill mappings - resolve \`use\` with \`npx @tanstack/intent@latest resolve <use>\`.
skills:
  - when: "Query data fetching"
    use: "@tanstack/query"
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
})
