import { describe, expect, it } from 'vitest'
import { buildIntentSkillsBlock } from '../src/commands/install-writer.js'
import type { IntentPackage, ScanResult, SkillEntry } from '../src/types.js'

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

describe('install writer block builder', () => {
  it('builds a deterministic block with stable load paths', () => {
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
# Skill mappings - when working in these areas, load the linked skill file into context.
skills:
  - task: "Use @tanstack/query fetching: Query data fetching patterns"
    load: "node_modules/@tanstack/query/skills/fetching/SKILL.md"
  - task: "Use @tanstack/query mutations: Mutation patterns"
    load: "node_modules/@tanstack/query/skills/mutations/SKILL.md"
  - task: "Use @tanstack/router routing: Routing patterns"
    load: "node_modules/@tanstack/router/skills/routing/SKILL.md"
<!-- intent-skills:end -->
`)
  })

  it('uses runtime lookup comments for unsafe paths', () => {
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
    expect(generated.block).toContain(
      '# Runtime lookup only: run `npx @tanstack/intent@latest list --json`, find package "@tanstack/query" skill "global-fetching", and load its reported path for this session. Do not copy the resolved path into this file.',
    )
    expect(generated.block).toContain(
      '# Runtime lookup only: run `npx @tanstack/intent@latest list --json`, find package "@tanstack/query" skill "pnpm-fetching", and load its reported path for this session. Do not copy the resolved path into this file.',
    )
    expect(generated.block).not.toContain('/home/sarah')
    expect(generated.block).not.toContain('node_modules/.pnpm')
    expect(generated.block).not.toContain('load:')
  })

  it('maps only top-level actionable skills', () => {
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
          skill({ name: 'publish', description: 'Maintainer task', type: 'meta' }),
          skill({
            name: 'release',
            description: 'Maintainer-only task',
            type: 'maintainer-only',
          }),
        ],
      }),
    ])

    const generated = buildIntentSkillsBlock(result)

    expect(generated.mappingCount).toBe(1)
    expect(generated.block).toContain('Use @tanstack/query core: Core skill')
    expect(generated.block).not.toContain('core/fetching')
    expect(generated.block).not.toContain('Reference material')
    expect(generated.block).not.toContain('Maintainer task')
    expect(generated.block).not.toContain('Maintainer-only task')
  })

  it('escapes generated task and load strings', () => {
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

    expect(generated.block).toContain(
      'task: "Use @tanstack/query quotes: Use \\"quoted\\" names"',
    )
    expect(generated.block).toContain(
      'load: "node_modules/@tanstack/query/skills/\\"quotes\\"/SKILL.md"',
    )
  })
})
