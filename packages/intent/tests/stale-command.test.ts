import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCheckSkillsWorkflowAdvisories,
  INTENT_CHECK_SKILLS_WORKFLOW_VERSION,
} from '../src/cli-support.js'
import { runStaleCommand } from '../src/commands/stale.js'

describe('runStaleCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const tempDirs: Array<string> = []

  afterEach(() => {
    logSpy.mockClear()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints review signals in non-json output', async () => {
    await runStaleCommand(undefined, {}, async () => ({
      reports: [
        {
          library: '@tanstack/router',
          currentVersion: '1.0.0',
          skillVersion: '1.0.0',
          versionDrift: null,
          skills: [],
          signals: [
            {
              type: 'missing-package-coverage',
              library: '@tanstack/router',
              packageName: '@tanstack/react-start-rsc',
              reasons: ['package is not represented in skills or artifacts'],
              needsReview: true,
            },
          ],
        },
      ],
    }))

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('@tanstack/router')
    expect(output).toContain('@tanstack/react-start-rsc')
    expect(output).toContain('package is not represented')
    expect(output).not.toContain('All skills up-to-date')
  })

  it('prints workflow update advisories in non-json output', async () => {
    await runStaleCommand(undefined, {}, async () => ({
      reports: [],
      workflowAdvisories: [
        'Intent workflow update available: run `npx @tanstack/intent@latest setup`.',
      ],
    }))

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Intent workflow update available')
    expect(output).toContain('npx @tanstack/intent@latest setup')
    expect(output).toContain('No intent-enabled packages found.')
  })

  it('does not print workflow update advisories in json output', async () => {
    await runStaleCommand(undefined, { json: true }, async () => ({
      reports: [],
      workflowAdvisories: [
        'Intent workflow update available: run `npx @tanstack/intent@latest setup`.',
      ],
    }))

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toBe('[]')
  })
})

describe('getCheckSkillsWorkflowAdvisories', () => {
  const tempDirs: Array<string> = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function writeWorkflow(content: string): string {
    const root = mkdtempSync(join(tmpdir(), 'intent-workflow-advisory-'))
    tempDirs.push(root)
    const workflowDir = join(root, '.github', 'workflows')
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(join(workflowDir, 'check-skills.yml'), content)
    return root
  }

  it('advises when the workflow has no intent version stamp', () => {
    const root = writeWorkflow('name: Check Skills\n')

    expect(getCheckSkillsWorkflowAdvisories(root)).toEqual([
      expect.stringContaining('Intent workflow update available'),
    ])
  })

  it('advises when the workflow has an old intent version stamp', () => {
    const root = writeWorkflow(
      `# intent-workflow-version: ${INTENT_CHECK_SKILLS_WORKFLOW_VERSION - 1}\n`,
    )

    expect(getCheckSkillsWorkflowAdvisories(root)).toEqual([
      expect.stringContaining('npx @tanstack/intent@latest setup'),
    ])
  })

  it('does not advise when the workflow has the current version stamp', () => {
    const root = writeWorkflow(
      `# intent-workflow-version: ${INTENT_CHECK_SKILLS_WORKFLOW_VERSION}\n`,
    )

    expect(getCheckSkillsWorkflowAdvisories(root)).toEqual([])
  })

  it('does not advise when the workflow is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-workflow-advisory-'))
    tempDirs.push(root)

    expect(getCheckSkillsWorkflowAdvisories(root)).toEqual([])
  })
})
