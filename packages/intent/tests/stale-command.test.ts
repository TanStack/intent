import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INTENT_CHECK_SKILLS_WORKFLOW_VERSION,
  getCheckSkillsWorkflowAdvisories,
} from '../src/commands/support.js'
import { runStaleCommand } from '../src/commands/stale.js'
import type { MockInstance } from 'vitest'

describe('runStaleCommand', () => {
  const originalCwd = process.cwd()
  let logSpy: MockInstance<typeof console.log>
  const tempDirs: Array<string> = []

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.unstubAllEnvs()
    process.chdir(originalCwd)
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints review signals in non-json output', async () => {
    await runStaleCommand(undefined, {}, () =>
      Promise.resolve({
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
      }),
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('@tanstack/router')
    expect(output).toContain('@tanstack/react-start-rsc')
    expect(output).toContain('package is not represented')
    expect(output).toContain('meta generate-skill')
    expect(output).toContain(
      'with this report and the relevant code/docs change',
    )
    expect(output).not.toContain('All skills up-to-date')
  })

  it('prints a review signal raised by two artifact files once in non-json output', async () => {
    const reason =
      'artifact library.version (1.2.0) differs from SKILL.md library_version (1.0.0)'
    await runStaleCommand(undefined, {}, () =>
      Promise.resolve({
        reports: [
          {
            library: '@tanstack/router',
            currentVersion: '1.1.0',
            skillVersion: '1.0.0',
            versionDrift: 'minor',
            skills: [],
            signals: ['domain_map.yaml', 'skill_tree.yaml'].map((file) => ({
              type: 'artifact-library-version-drift',
              library: '@tanstack/router',
              subject: 'routing',
              reasons: [reason],
              needsReview: true,
              artifactPath: `_artifacts/${file}`,
              skill: 'routing',
            })),
          },
        ],
      }),
    )

    const lines = logSpy.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.includes(reason))).toEqual([
      `  ⚠ routing: ${reason}`,
    ])
  })

  it('prints workflow update advisories in non-json output', async () => {
    await runStaleCommand(undefined, {}, () =>
      Promise.resolve({
        reports: [],
        workflowAdvisories: [
          'Intent workflow update available: run `npx @tanstack/intent@latest setup`.',
        ],
      }),
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Intent workflow update available')
    expect(output).toContain('npx @tanstack/intent@latest setup')
    expect(output).toContain('No intent-enabled packages found.')
    expect(output).not.toContain('meta generate-skill')
  })

  it('does not suggest content review for an up-to-date report', async () => {
    await runStaleCommand(undefined, {}, () =>
      Promise.resolve({
        reports: [
          {
            library: 'current-library',
            currentVersion: '1.0.0',
            skillVersion: '1.0.0',
            versionDrift: null,
            skills: [],
            signals: [],
          },
        ],
      }),
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('All skills up-to-date')
    expect(output).not.toContain('meta generate-skill')
  })

  it('keeps JSON review data free of next-action text', async () => {
    const reports = [
      {
        library: 'changed-library',
        currentVersion: '1.1.0',
        skillVersion: '1.0.0',
        versionDrift: 'minor' as const,
        skills: [{ name: 'core', needsReview: true, reasons: ['minor drift'] }],
        signals: [],
      },
    ]
    await runStaleCommand(undefined, { json: true }, () =>
      Promise.resolve({ reports }),
    )

    expect(logSpy.mock.calls).toHaveLength(1)
    expect(JSON.parse(logSpy.mock.calls[0]![0])).toEqual(reports)
  })

  it('does not print workflow update advisories in json output', async () => {
    await runStaleCommand(undefined, { json: true }, () =>
      Promise.resolve({
        reports: [],
        workflowAdvisories: [
          'Intent workflow update available: run `npx @tanstack/intent@latest setup`.',
        ],
      }),
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toBe('[]')
  })

  it('writes GitHub review files for stale review signals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-stale-github-review-'))
    tempDirs.push(root)
    process.chdir(root)
    vi.stubEnv('GITHUB_OUTPUT', join(root, 'github-output'))
    vi.stubEnv('GITHUB_STEP_SUMMARY', join(root, 'github-summary'))

    await runStaleCommand(
      undefined,
      { githubReview: true, packageLabel: '@tanstack/router' },
      () =>
        Promise.resolve({
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
    process.chdir(root)
    vi.stubEnv('GITHUB_OUTPUT', join(root, 'github-output'))
    vi.stubEnv('GITHUB_STEP_SUMMARY', join(root, 'github-summary'))

    await runStaleCommand(
      undefined,
      { githubReview: true, packageLabel: '@tanstack/router' },
      () => Promise.reject(new Error('boom')),
    )

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
      expect.stringContaining('run the installed `intent setup`'),
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
