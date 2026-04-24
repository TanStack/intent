import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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

  it('writes GitHub review files for stale review signals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-stale-github-review-'))
    tempDirs.push(root)
    const originalCwd = process.cwd()
    const previousOutput = process.env.GITHUB_OUTPUT
    const previousSummary = process.env.GITHUB_STEP_SUMMARY
    process.chdir(root)
    process.env.GITHUB_OUTPUT = join(root, 'github-output')
    process.env.GITHUB_STEP_SUMMARY = join(root, 'github-summary')

    try {
      await runStaleCommand(
        undefined,
        { githubReview: true, packageLabel: '@tanstack/router' },
        async () => ({
          reports: [
            {
              library: '@tanstack/router',
              currentVersion: null,
              skillVersion: null,
              versionDrift: null,
              skills: [],
              signals: [
                {
                  type: 'missing-package-coverage',
                  library: '@tanstack/react-start-rsc',
                  packageName: '@tanstack/react-start-rsc',
                  reasons: ['workspace package is not represented'],
                  needsReview: true,
                },
              ],
            },
          ],
          workflowAdvisories: [
            'Intent workflow update available: run `npx @tanstack/intent@latest setup`.',
          ],
        }),
      )
    } finally {
      process.chdir(originalCwd)
      if (previousOutput === undefined) {
        delete process.env.GITHUB_OUTPUT
      } else {
        process.env.GITHUB_OUTPUT = previousOutput
      }
      if (previousSummary === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummary
      }
    }

    expect(readFileSync(join(root, 'github-output'), 'utf8')).toContain(
      'has_review=true',
    )
    expect(readFileSync(join(root, 'pr-body.md'), 'utf8')).toContain(
      'Why This PR Opened',
    )
    expect(readFileSync(join(root, 'github-summary'), 'utf8')).toContain(
      'workspace package is not represented',
    )
    expect(readFileSync(join(root, 'pr-body.md'), 'utf8')).toContain(
      'workflow-advisory',
    )
    expect(readFileSync(join(root, 'pr-body.md'), 'utf8')).toContain(
      'Intent workflow update available',
    )
  })

  it('turns GitHub review stale check failures into review items', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-stale-github-failed-'))
    tempDirs.push(root)
    const originalCwd = process.cwd()
    const previousOutput = process.env.GITHUB_OUTPUT
    const previousSummary = process.env.GITHUB_STEP_SUMMARY
    process.chdir(root)
    process.env.GITHUB_OUTPUT = join(root, 'github-output')
    process.env.GITHUB_STEP_SUMMARY = join(root, 'github-summary')

    try {
      await runStaleCommand(
        undefined,
        { githubReview: true, packageLabel: '@tanstack/router' },
        async () => {
          throw new Error('boom')
        },
      )
    } finally {
      process.chdir(originalCwd)
      if (previousOutput === undefined) {
        delete process.env.GITHUB_OUTPUT
      } else {
        process.env.GITHUB_OUTPUT = previousOutput
      }
      if (previousSummary === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummary
      }
    }

    const items = JSON.parse(
      readFileSync(join(root, 'review-items.json'), 'utf8'),
    )
    expect(items).toEqual([
      expect.objectContaining({
        type: 'stale-check-failed',
        library: '@tanstack/router',
      }),
    ])
    expect(readFileSync(join(root, 'github-output'), 'utf8')).toContain(
      'has_review=true',
    )
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
