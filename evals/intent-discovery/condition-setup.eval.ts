import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

      expect(result.filesWritten).toEqual([])
      expect(existsSync(join(prepared.workspacePath, 'AGENTS.md'))).toBe(false)
      expect(
        readFileSync(join(prepared.workspacePath, 'package.json'), 'utf8'),
      ).not.toContain('"intent"')
    } finally {
      prepared.cleanup()
    }
  })

  it('writes current Intent guidance without mappings', () => {
    const prepared = prepareInTemp()

    try {
      const result = applyIntentCondition({
        condition: 'current-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const agents = readFileSync(
        join(prepared.workspacePath, 'AGENTS.md'),
        'utf8',
      )
      const packageJson = readFileSync(
        join(prepared.workspacePath, 'package.json'),
        'utf8',
      )

      expect(result.filesWritten).toHaveLength(4)
      expect(agents).toContain('Skill Loading')
      expect(agents).toContain('npx @tanstack/intent@latest list')
      expect(agents).not.toContain('\ntanstackIntent:\n')
      expect(packageJson).toContain('"@tanstack/router"')
      expect(
        existsSync(
          join(
            prepared.workspacePath,
            'node_modules',
            '@tanstack',
            'router',
            'skills',
            'routing',
            'SKILL.md',
          ),
        ),
      ).toBe(true)
    } finally {
      prepared.cleanup()
    }
  })

  it('writes mapped Intent guidance with use values', () => {
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

      expect(agents).toContain('tanstackIntent:')
      expect(agents).toContain('id: "@tanstack/router#routing"')
      expect(agents).toContain(
        'run: "npx @tanstack/intent@latest load @tanstack/router#routing"',
      )
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
