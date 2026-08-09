import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SESSION_CATALOGUE_MAX_BYTES,
  SESSION_CATALOGUE_MAX_SKILLS,
} from '../../packages/intent/src/skills/catalogue-contract.js'
import { measureStaticDeliveryContext } from './harness/delivery-context'
import {
  applyIntentCondition,
  buildVisibleMappedGuidance,
} from './harness/setup-intent-condition'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'

describe('Intent discovery condition setup', () => {
  it('leaves no-intent workspaces without Intent guidance', () => {
    const prepared = prepareInTemp()

    try {
      const result = applyIntentCondition({
        condition: 'no-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })

      expect(result).toEqual([])
      expect(existsSync(join(prepared.workspacePath, 'AGENTS.md'))).toBe(false)
      expect(
        readFileSync(join(prepared.workspacePath, 'package.json'), 'utf8'),
      ).not.toContain('"intent"')
    } finally {
      prepared.cleanup()
    }
  })

  it('symlinks package skills for native GitHub Copilot discovery', () => {
    const prepared = prepareInTemp()

    try {
      const result = applyIntentCondition({
        condition: 'symlink-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const linkPath = join(
        prepared.workspacePath,
        '.github',
        'skills',
        'npm-tanstack-router-routing',
      )
      const skillPath = join(
        prepared.workspacePath,
        'node_modules',
        '@tanstack',
        'router',
        'skills',
        'routing',
      )

      expect(result).toContain(linkPath)
      expect(existsSync(join(prepared.workspacePath, 'AGENTS.md'))).toBe(false)
      expect(existsSync(join(prepared.workspacePath, 'intent.lock'))).toBe(true)
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
      expect(realpathSync(linkPath)).toBe(realpathSync(skillPath))
      const skill = readFileSync(join(skillPath, 'SKILL.md'), 'utf8')
      expect(skill).toContain('TanStack Router route loaders')
      expect(skill).toContain(
        'Read loader data through `Route.useLoaderData()`',
      )
      expect(skill).not.toMatch(/\beval\b/i)
    } finally {
      prepared.cleanup()
    }
  })

  it('writes package skill maps for mapped delivery', () => {
    const prepared = prepareInTemp()

    try {
      applyIntentCondition({
        condition: 'mapped-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const agents = readFileSync(
        join(prepared.workspacePath, 'AGENTS.md'),
        'utf8',
      )
      const routerMap = readFileSync(
        join(
          prepared.workspacePath,
          '.intent',
          'maps',
          '@tanstack',
          'router.md',
        ),
        'utf8',
      )

      expect(agents).toContain('## Intent Skills')
      expect(agents).toContain('`.intent/maps/@tanstack/router.md`')
      expect(agents).toContain(
        'At the start of every task, inspect the package list below.',
      )
      expect(agents).toContain('Never infer, shorten, or guess an ID.')
      expect(agents).toContain(
        'Do not run an Intent load command until you have read the map.',
      )
      expect(agents).toContain('npx @tanstack/intent load <id>')
      expect(agents).not.toContain('catalog')
      expect(routerMap).toContain('`@tanstack/router#routing`')
      expect(routerMap).toContain('TanStack Router route loaders')
      expect(existsSync(join(prepared.workspacePath, 'intent.lock'))).toBe(true)
    } finally {
      prepared.cleanup()
    }
  })

  it('writes visible exact commands for mapped exact delivery', () => {
    const prepared = prepareInTemp()

    try {
      const result = applyIntentCondition({
        condition: 'mapped-exact-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const agentsPath = join(prepared.workspacePath, 'AGENTS.md')
      const agents = readFileSync(agentsPath, 'utf8')

      expect(result).toEqual(expect.arrayContaining([agentsPath]))
      expect(agents).toContain('- id: "@tanstack/router#routing"')
      expect(agents).toContain(
        'run: "npx @tanstack/intent load @tanstack/router#routing"',
      )
      expect(agents).toContain(
        'for: "TanStack Router route loaders, route params, pending states, and loader data consumption."',
      )
      expect(Buffer.byteLength(agents)).toBeLessThanOrEqual(
        SESSION_CATALOGUE_MAX_BYTES,
      )
      expect(existsSync(join(prepared.workspacePath, '.intent', 'maps'))).toBe(
        false,
      )
      expect(
        measureStaticDeliveryContext({
          condition: 'mapped-exact-intent',
          expectedSkillCount: 1,
          workspacePath: prepared.workspacePath,
        }),
      ).toMatchObject({
        approximateTokenCount: Math.ceil(Buffer.byteLength(agents) / 4),
        exactLoadCommands: true,
        injectedBytes: Buffer.byteLength(agents),
        injectionFrequency: 'repository-instruction',
        omittedSkillCount: 0,
        representedSkillCount: 1,
        supplementalBytes: 0,
      })
    } finally {
      prepared.cleanup()
    }
  })

  it('measures package maps separately from injected repository context', () => {
    const prepared = prepareInTemp()

    try {
      applyIntentCondition({
        condition: 'mapped-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const agents = readFileSync(
        join(prepared.workspacePath, 'AGENTS.md'),
        'utf8',
      )
      const routerMap = readFileSync(
        join(
          prepared.workspacePath,
          '.intent',
          'maps',
          '@tanstack',
          'router.md',
        ),
        'utf8',
      )

      expect(
        measureStaticDeliveryContext({
          condition: 'mapped-intent',
          expectedSkillCount: 1,
          workspacePath: prepared.workspacePath,
        }),
      ).toMatchObject({
        approximateTokenCount: Math.ceil(Buffer.byteLength(agents) / 4),
        exactLoadCommands: false,
        injectedBytes: Buffer.byteLength(agents),
        omittedSkillCount: 0,
        representedSkillCount: 1,
        supplementalBytes: Buffer.byteLength(routerMap),
      })
    } finally {
      prepared.cleanup()
    }
  })

  it('bounds visible exact mappings and reports omitted skills', () => {
    const guidance = buildVisibleMappedGuidance(
      Array.from({ length: 100 }, (_, index) => ({
        description: `Skill ${index} ${'description '.repeat(20)}`,
        name: `skill-${index}`,
        packageName: `@tanstack/package-${index}`,
      })),
    )

    expect(Buffer.byteLength(guidance)).toBeLessThanOrEqual(
      SESSION_CATALOGUE_MAX_BYTES,
    )
    expect([...guidance.matchAll(/^\s*- id: /gm)].length).toBeLessThanOrEqual(
      SESSION_CATALOGUE_MAX_SKILLS,
    )
    expect(guidance).toMatch(/additional skills omitted/)
  })

  it('prepares trusted skills for hook delivery without agent guidance', () => {
    const prepared = prepareInTemp()

    try {
      applyIntentCondition({
        condition: 'hooked-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })

      expect(existsSync(join(prepared.workspacePath, 'AGENTS.md'))).toBe(false)
      expect(existsSync(join(prepared.workspacePath, 'intent.lock'))).toBe(true)
    } finally {
      prepared.cleanup()
    }
  })

  it('prepares trusted skills for hook exact delivery without agent guidance', () => {
    const prepared = prepareInTemp()

    try {
      applyIntentCondition({
        condition: 'hooked-exact-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })

      expect(existsSync(join(prepared.workspacePath, 'AGENTS.md'))).toBe(false)
      expect(existsSync(join(prepared.workspacePath, 'intent.lock'))).toBe(true)
    } finally {
      prepared.cleanup()
    }
  })
})

function prepareInTemp() {
  const parentDir = mkdtempSync(join(tmpdir(), 'intent-eval-condition-'))
  const prepared = prepareFixtureWorkspace({
    fixture: 'router-basic',
    parentDir,
  })

  return {
    ...prepared,
    cleanup() {
      prepared.cleanup()
      rmSync(parentDir, { recursive: true, force: true })
    },
  }
}
