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
import { applyIntentCondition } from './harness/setup-intent-condition'
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

  it('writes catalog-once guidance for mapped delivery', () => {
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

      expect(agents).toContain('## Intent Skills')
      expect(agents).toContain('npx @tanstack/intent catalog')
      expect(agents).toContain('npx @tanstack/intent load <package>#<skill>')
      expect(agents).not.toContain('tanstackIntent:')
      expect(existsSync(join(prepared.workspacePath, 'intent.lock'))).toBe(true)
    } finally {
      prepared.cleanup()
    }
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
