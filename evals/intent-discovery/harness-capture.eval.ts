import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixtures } from './corpus/fixtures'
import { savedTranscriptCases } from './fixtures/saved-transcripts'
import { gradeDiscovery } from './graders/discovery'
import {
  intentCommandsFromToolCalls,
  parseIntentCommand,
} from './harness/parse-intent-commands'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'
import { extractTurnEvidence } from './harness/session-events'
import { scoreLiveSession } from './graders/session-scoring'

describe('Intent discovery harness capture', () => {
  it('requires every catalog, load, abstention, runner, and task check', () => {
    const turns = [
      sessionTurn('unrelated-format', 'unrelated', {
        catalogCommands: ['npx @tanstack/intent catalog'],
      }),
      sessionTurn('router-loader', 'related', {
        expectedSkillArea: 'router',
        intentLoads: ['@tanstack/router#routing'],
      }),
      sessionTurn('start-server-function', 'related', {
        expectedSkillArea: 'start',
        intentLoads: ['@tanstack/start#server-functions'],
      }),
      sessionTurn('table-sorting', 'related', {
        expectedSkillArea: 'table-v9',
        intentLoads: ['@tanstack/table#v9-columns'],
      }),
      sessionTurn('unrelated-sort', 'unrelated'),
    ]

    expect(scoreLiveSession('mapped-intent', turns)).toMatchObject({
      agentCatalogCount: 1,
      catalogCorrect: true,
      passed: true,
      relatedCorrect: 3,
      taskCompletionCount: 5,
      unrelatedCorrect: 2,
      wrongSkillLoads: 0,
    })

    turns[2] = sessionTurn('start-server-function', 'related', {
      expectedSkillArea: 'start',
      intentLoads: ['@tanstack/router#routing'],
    })
    expect(scoreLiveSession('mapped-intent', turns)).toMatchObject({
      passed: false,
      relatedCorrect: 2,
      wrongSkillLoads: 1,
    })
  })

  it('scores no-intent sessions on task and runner completion', () => {
    const turns = [
      sessionTurn('router-loader', 'related', {
        expectedSkillArea: 'router',
      }),
      sessionTurn('unrelated-format', 'unrelated'),
    ]

    expect(scoreLiveSession('no-intent', turns)).toMatchObject({
      catalogCorrect: true,
      passed: true,
      runnerCompletionCount: 2,
      taskCompletionCount: 2,
      wrongSkillLoads: 0,
    })
  })

  it('requires one hook catalog injection per Copilot process', () => {
    const turns = [
      sessionTurn('unrelated-format', 'unrelated', {
        hookCatalogInjections: 1,
      }),
      sessionTurn('router-loader', 'related', {
        expectedSkillArea: 'router',
        hookCatalogInjections: 1,
        intentLoads: ['@tanstack/router#routing'],
      }),
      sessionTurn('start-server-function', 'related', {
        expectedSkillArea: 'start',
        hookCatalogInjections: 1,
        intentLoads: ['@tanstack/start#server-functions'],
      }),
      sessionTurn('table-sorting', 'related', {
        expectedSkillArea: 'table-v9',
        hookCatalogInjections: 1,
        intentLoads: ['@tanstack/table#v9-columns'],
      }),
      sessionTurn('unrelated-sort', 'unrelated', {
        hookCatalogInjections: 1,
      }),
    ]

    expect(scoreLiveSession('hooked-intent', turns)).toMatchObject({
      catalogCorrect: true,
      hookCatalogInjections: 5,
      passed: true,
    })

    turns[1] = sessionTurn('router-loader', 'related', {
      expectedSkillArea: 'router',
      hookCatalogInjections: 2,
      intentLoads: ['@tanstack/router#routing'],
    })
    expect(scoreLiveSession('hooked-intent', turns)).toMatchObject({
      catalogCorrect: false,
      hookCatalogInjections: 6,
      passed: false,
    })
  })

  it('extracts turn-local evidence from structured Copilot events', () => {
    expect(
      extractTurnEvidence([
        {
          type: 'skill.invoked',
          data: {
            path: '/workspace/.github/skills/npm-tanstack-router-routing/SKILL.md',
          },
        },
        {
          type: 'tool.execution_start',
          data: {
            toolName: 'bash',
            arguments: {
              command:
                'npx @tanstack/intent catalog && npx @tanstack/intent load @tanstack/start#server-functions',
            },
          },
        },
        {
          type: 'assistant.message',
          data: { content: 'Completed the turn.', model: 'test-model' },
        },
      ]),
    ).toEqual({
      catalogCommands: ['npx @tanstack/intent catalog'],
      finalAnswer: 'Completed the turn.',
      intentLoads: ['@tanstack/start#server-functions'],
      model: 'test-model',
      nativeSkills: ['@tanstack/router#routing'],
      shellCommands: [
        'npx @tanstack/intent catalog && npx @tanstack/intent load @tanstack/start#server-functions',
      ],
    })
  })

  it.each([
    ['intent list', 'intent list', undefined],
    [
      'pnpm exec intent load @tanstack/router#routing',
      'pnpm exec intent load @tanstack/router#routing',
      '@tanstack/router#routing',
    ],
    [
      'npx @tanstack/intent load @tanstack/start#routing',
      'npx @tanstack/intent load @tanstack/start#routing',
      '@tanstack/start#routing',
    ],
    [
      'cd /tmp/eval/router-basic && npx @tanstack/intent@latest load @tanstack/router#routing 2>&1',
      'npx @tanstack/intent@latest load @tanstack/router#routing',
      '@tanstack/router#routing',
    ],
    [
      'pnpm dlx @tanstack/intent@latest load @tanstack/router#routing',
      'pnpm dlx @tanstack/intent@latest load @tanstack/router#routing',
      '@tanstack/router#routing',
    ],
    [
      'pnpm dlx @tanstack/intent@latest list',
      'pnpm dlx @tanstack/intent@latest list',
      undefined,
    ],
    [
      'pnpm dlx @tanstack/intent list',
      'pnpm dlx @tanstack/intent list',
      undefined,
    ],
    [
      'yarn dlx @tanstack/intent@latest load @tanstack/router#routing',
      'yarn dlx @tanstack/intent@latest load @tanstack/router#routing',
      '@tanstack/router#routing',
    ],
    [
      'yarn dlx @tanstack/intent@latest list',
      'yarn dlx @tanstack/intent@latest list',
      undefined,
    ],
    [
      'yarn dlx @tanstack/intent list',
      'yarn dlx @tanstack/intent list',
      undefined,
    ],
    [
      'bunx @tanstack/intent@latest load @tanstack/router#routing',
      'bunx @tanstack/intent@latest load @tanstack/router#routing',
      '@tanstack/router#routing',
    ],
    [
      'bunx @tanstack/intent@latest list',
      'bunx @tanstack/intent@latest list',
      undefined,
    ],
    ['bunx @tanstack/intent list', 'bunx @tanstack/intent list', undefined],
  ])('parses %s', (command, raw, skillUse) => {
    expect(
      intentCommandsFromToolCalls([
        { name: 'shell_command', arguments: { command } },
      ]),
    ).toEqual([
      expect.objectContaining({
        action: skillUse ? 'load' : 'list',
        raw,
        skillUse,
        source: 'tool-call',
      }),
    ])
  })

  it('does not parse prose mentions as strict invocation', () => {
    expect(
      parseIntentCommand(
        'I would run intent load @tanstack/router#routing',
        'tool-message',
      ),
    ).toBeUndefined()
  })

  it('normalizes shell quotes around loaded skill IDs', () => {
    expect(
      parseIntentCommand("intent load '@tanstack/router#routing'", 'tool-call'),
    ).toMatchObject({
      raw: 'intent load @tanstack/router#routing',
      skillUse: '@tanstack/router#routing',
    })
  })

  it('grades native skill loads only for symlink discovery', () => {
    const run = {
      artifacts: { nativeSkillsLoaded: ['@tanstack/router#routing'] },
      errors: [],
      output: {},
      session: { messages: [] },
      usage: {},
    }

    expect(gradeDiscovery(run, ['router'], 'symlink-intent').loaded).toEqual({
      passed: true,
      loadedSkills: ['@tanstack/router#routing'],
    })
    expect(gradeDiscovery(run, ['start'], 'symlink-intent').loaded.passed).toBe(
      false,
    )
    expect(gradeDiscovery(run, ['router'], 'mapped-intent').loaded.passed).toBe(
      false,
    )
    expect(
      gradeDiscovery(run, ['router'], 'symlink-intent').discovery.passed,
    ).toBe(true)
    expect(
      gradeDiscovery(run, ['router'], 'mapped-intent').discovery.passed,
    ).toBe(false)
    expect(
      gradeDiscovery(run, ['router'], 'hooked-intent').discovery.passed,
    ).toBe(false)
  })

  it('parses version-pinned Intent commands', () => {
    expect(
      parseIntentCommand(
        '$ npx @tanstack/intent@0.3 load @tanstack/router#routing',
        'tool-message',
      ),
    ).toMatchObject({
      action: 'load',
      executable: 'npx @tanstack/intent@0.3',
      skillUse: '@tanstack/router#routing',
    })
  })

  it('does not treat user prompt skill mentions as reference-only evidence', () => {
    expect(
      gradeDiscovery(
        {
          errors: [],
          output: { finalAnswer: 'Done.' },
          session: {
            messages: [
              {
                role: 'user',
                content: 'Use TanStack Router if needed.',
              },
              {
                role: 'assistant',
                content: 'Done.',
              },
            ],
          },
          usage: {},
        },
        ['router'],
        'plain-docs',
      ).reference,
    ).toBe(false)
  })

  it('prepares an isolated workspace for every task fixture', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'intent-eval-fixtures-'))

    try {
      for (const task of savedTranscriptCases) {
        const prepared = prepareFixtureWorkspace({
          fixture: task.fixture,
          parentDir,
        })
        const fixture = fixtures[task.fixture]

        for (const file of fixture.files) {
          expect(existsSync(join(prepared.workspacePath, file))).toBe(true)
        }

        mkdirSync(join(prepared.workspacePath, 'src', 'generated'), {
          recursive: true,
        })
        prepared.cleanup()
        expect(existsSync(prepared.workspacePath)).toBe(false)
      }
    } finally {
      rmSync(parentDir, { recursive: true, force: true })
    }
  })

  it('does not mutate the source fixture while preparing a workspace', () => {
    const prepared = prepareFixtureWorkspace({ fixture: 'router-basic' })

    try {
      const sourcePackageJson = readFileSync(
        join(prepared.sourcePath, 'package.json'),
        'utf8',
      )
      const copiedPackageJson = readFileSync(
        join(prepared.workspacePath, 'package.json'),
        'utf8',
      )

      expect(copiedPackageJson).toBe(sourcePackageJson)
      expect(prepared.workspacePath).not.toBe(prepared.sourcePath)
    } finally {
      prepared.cleanup()
    }
  })
})

function sessionTurn(
  id: string,
  kind: 'related' | 'unrelated',
  overrides: {
    catalogCommands?: Array<string>
    expectedSkillArea?: 'router' | 'start' | 'table-v9'
    hookCatalogInjections?: number
    intentLoads?: Array<string>
  } = {},
) {
  const hookCatalogInjections = overrides.hookCatalogInjections ?? 0

  return {
    id,
    kind,
    catalogCommands: overrides.catalogCommands ?? [],
    expectedSkillArea: overrides.expectedSkillArea,
    hookCatalogInjections,
    intentLoads: overrides.intentLoads ?? [],
    nativeSkills: [],
    runnerCompleted: true,
    taskPassed: true,
  }
}
