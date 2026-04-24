import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildStaleReviewBody,
  collectStaleReviewItems,
  createFailedStaleReviewItem,
  writeStaleReviewWorkflowFiles,
} from '../src/workflow-review.js'
import type { StalenessReport } from '../src/types.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')

function report(overrides: Partial<StalenessReport>): StalenessReport {
  return {
    library: '@tanstack/router',
    currentVersion: null,
    skillVersion: null,
    versionDrift: null,
    skills: [],
    signals: [],
    ...overrides,
  }
}

describe('workflow review helpers', () => {
  const tempDirs: Array<string> = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('collects stale skills and review signals into one item list', () => {
    const items = collectStaleReviewItems([
      report({
        skills: [
          {
            name: 'routing',
            reasons: ['version drift (1.0.0 -> 1.1.0)'],
            needsReview: true,
          },
          {
            name: 'clean',
            reasons: [],
            needsReview: false,
          },
        ],
        signals: [
          {
            type: 'missing-package-coverage',
            library: '@tanstack/react-start-rsc',
            packageName: '@tanstack/react-start-rsc',
            packageRoot: 'packages/react-start-rsc',
            reasons: ['workspace package is not represented'],
            needsReview: true,
          },
          {
            type: 'artifact-source-drift',
            skill: 'start-core',
            reasons: ['artifact sources differ'],
            needsReview: true,
          },
        ],
      }),
    ])

    expect(items).toEqual([
      expect.objectContaining({
        type: 'stale-skill',
        library: '@tanstack/router',
        subject: 'routing',
      }),
      expect.objectContaining({
        type: 'missing-package-coverage',
        library: '@tanstack/react-start-rsc',
        subject: '@tanstack/react-start-rsc',
        packageRoot: 'packages/react-start-rsc',
      }),
      expect.objectContaining({
        type: 'artifact-source-drift',
        library: '@tanstack/router',
        subject: 'start-core',
      }),
    ])
  })

  it('returns no review items for clean reports', () => {
    expect(
      collectStaleReviewItems([
        report({
          skills: [{ name: 'routing', reasons: [], needsReview: false }],
        }),
      ]),
    ).toEqual([])
  })

  it('builds a grouped review body with maintainer prompt', () => {
    const body = buildStaleReviewBody([
      {
        type: 'stale-skill',
        library: '@tanstack/router',
        subject: 'routing',
        reasons: ['version drift'],
      },
      {
        type: 'missing-package-coverage',
        library: '@tanstack/react-start-rsc',
        subject: '@tanstack/react-start-rsc',
        reasons: ['workspace package is not represented'],
        packageName: '@tanstack/react-start-rsc',
      },
      {
        type: 'missing-package-coverage',
        library: '@tanstack/start-server-functions',
        subject: '@tanstack/start-server-functions',
        reasons: ['workspace package is not represented'],
        packageName: '@tanstack/start-server-functions',
      },
    ])

    expect(body).toContain('| `missing-package-coverage` | 2 |')
    expect(body).toContain('| `stale-skill` | 1 |')
    expect(body).toContain('### Why This PR Opened')
    expect(body).toContain(
      '- `missing-package-coverage` for `@tanstack/react-start-rsc`: workspace package is not represented',
    )
    expect(body).toContain('`@tanstack/react-start-rsc`')
    expect(body).toContain(
      'Before editing skills or artifacts, ask the maintainer:',
    )
    expect(body).toContain('- Do not auto-generate skills.')
    expect(body).toContain(
      'Summarize every package as one of: existing-skill coverage, new skill, ignored, or deferred.',
    )
  })

  it('builds a useful failed stale check review item', () => {
    const item = createFailedStaleReviewItem('@tanstack/router')
    const body = buildStaleReviewBody([item])

    expect(item).toMatchObject({
      type: 'stale-check-failed',
      library: '@tanstack/router',
      subject: 'intent stale --json',
    })
    expect(body).toContain('| `stale-check-failed` | 1 |')
    expect(body).toContain('Review the workflow logs before updating skills.')
  })

  it('writes GitHub review files and outputs for review items', () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-workflow-review-'))
    tempDirs.push(root)
    const outputPath = join(root, 'github-output')
    const summaryPath = join(root, 'github-summary')
    const reviewItemsPath = join(root, 'review-items.json')
    const prBodyPath = join(root, 'pr-body.md')

    writeStaleReviewWorkflowFiles(
      [
        {
          type: 'missing-package-coverage',
          library: '@tanstack/react-start-rsc',
          subject: '@tanstack/react-start-rsc',
          reasons: ['workspace package is not represented'],
        },
      ],
      { outputPath, prBodyPath, reviewItemsPath, summaryPath },
    )

    expect(readFileSync(outputPath, 'utf8')).toContain('has_review=true')
    expect(JSON.parse(readFileSync(reviewItemsPath, 'utf8'))).toEqual([
      expect.objectContaining({ type: 'missing-package-coverage' }),
    ])
    expect(readFileSync(prBodyPath, 'utf8')).toContain('Why This PR Opened')
    expect(readFileSync(summaryPath, 'utf8')).toContain('Why This PR Opened')
  })

  it('writes a clean GitHub summary without creating a PR body when no review is needed', () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-workflow-review-clean-'))
    tempDirs.push(root)
    const outputPath = join(root, 'github-output')
    const summaryPath = join(root, 'github-summary')
    const reviewItemsPath = join(root, 'review-items.json')
    const prBodyPath = join(root, 'pr-body.md')

    writeStaleReviewWorkflowFiles([], {
      outputPath,
      prBodyPath,
      reviewItemsPath,
      summaryPath,
    })

    expect(readFileSync(outputPath, 'utf8')).toContain('has_review=false')
    expect(JSON.parse(readFileSync(reviewItemsPath, 'utf8'))).toEqual([])
    expect(readFileSync(summaryPath, 'utf8')).toContain(
      'No stale skills or coverage gaps found.',
    )
    expect(existsSync(prBodyPath)).toBe(false)
  })

  it('keeps the generated workflow short and delegated to CLI helpers', () => {
    const template = readFileSync(
      join(
        repoRoot,
        'packages',
        'intent',
        'meta',
        'templates',
        'workflows',
        'check-skills.yml',
      ),
      'utf8',
    )

    expect(template).toContain('intent validate --github-summary')
    expect(template).toContain(
      'intent stale --github-review --package-label "{{PACKAGE_LABEL}}"',
    )
    expect(template).not.toContain('const reports = JSON.parse')
    expect(template).not.toContain('for (const skill of report.skills ?? [])')
    expect(template).not.toContain('for (const signal of report.signals ?? [])')
    expect(template).not.toContain('signal?.message')
    expect(template).toContain('gh pr edit "$PR_URL" --body-file pr-body.md')
    expect(template).toContain('gh pr create \\')
    expect(template).toContain('--body-file pr-body.md')
  })
})
