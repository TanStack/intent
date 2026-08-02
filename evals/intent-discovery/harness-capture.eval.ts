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
import { tasks } from './corpus/tasks'
import { correctSkillLoaded } from './graders/correct-skill-loaded'
import { referenceOnly } from './graders/reference-only'
import { discoveryInvocation } from './graders/strict-invocation'
import {
  intentCommandsFromToolCalls,
  nativeSkillNamesFromTranscript,
  parseIntentCommand,
} from './harness/parse-intent-commands'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'
import { extractTurnEvidence } from './harness/session-events'
import { scoreLiveSession } from './graders/session-scoring'
import type { ToolCallRecord } from 'vitest-evals'

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

  it('requires one hook catalog injection per Copilot process', () => {
    const turns = [
      sessionTurn('unrelated-format', 'unrelated', {
        hookCatalogInjected: true,
      }),
      sessionTurn('router-loader', 'related', {
        expectedSkillArea: 'router',
        hookCatalogInjected: true,
        intentLoads: ['@tanstack/router#routing'],
      }),
      sessionTurn('start-server-function', 'related', {
        expectedSkillArea: 'start',
        hookCatalogInjected: true,
        intentLoads: ['@tanstack/start#server-functions'],
      }),
      sessionTurn('table-sorting', 'related', {
        expectedSkillArea: 'table-v9',
        hookCatalogInjected: true,
        intentLoads: ['@tanstack/table#v9-columns'],
      }),
      sessionTurn('unrelated-sort', 'unrelated', {
        hookCatalogInjected: true,
      }),
    ]

    expect(scoreLiveSession('hooked-intent', turns)).toMatchObject({
      catalogCorrect: true,
      hookCatalogInjections: 5,
      passed: true,
    })

    turns[1] = sessionTurn('router-loader', 'related', {
      expectedSkillArea: 'router',
      hookCatalogInjected: true,
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

  it('parses accepted Intent command forms from tool calls', () => {
    const calls: Array<ToolCallRecord> = [
      { name: 'shell_command', arguments: { command: 'intent list' } },
      {
        name: 'shell_command',
        arguments: {
          command: 'pnpm exec intent load @tanstack/router#routing',
        },
      },
      {
        name: 'shell_command',
        arguments: {
          command: 'npx @tanstack/intent load @tanstack/start#routing',
        },
      },
      {
        name: 'shell_command',
        arguments: {
          command:
            'cd /tmp/eval/router-basic && npx @tanstack/intent@latest load @tanstack/router#routing 2>&1',
        },
      },
      {
        name: 'shell_command',
        arguments: {
          command:
            'pnpm dlx @tanstack/intent@latest load @tanstack/router#routing',
        },
      },
      {
        name: 'shell_command',
        arguments: { command: 'pnpm dlx @tanstack/intent@latest list' },
      },
      {
        name: 'shell_command',
        arguments: { command: 'pnpm dlx @tanstack/intent list' },
      },
      {
        name: 'shell_command',
        arguments: {
          command:
            'yarn dlx @tanstack/intent@latest load @tanstack/router#routing',
        },
      },
      {
        name: 'shell_command',
        arguments: { command: 'yarn dlx @tanstack/intent@latest list' },
      },
      {
        name: 'shell_command',
        arguments: { command: 'yarn dlx @tanstack/intent list' },
      },
      {
        name: 'shell_command',
        arguments: {
          command: 'bunx @tanstack/intent@latest load @tanstack/router#routing',
        },
      },
      {
        name: 'shell_command',
        arguments: { command: 'bunx @tanstack/intent@latest list' },
      },
      {
        name: 'shell_command',
        arguments: { command: 'bunx @tanstack/intent list' },
      },
    ]

    expect(intentCommandsFromToolCalls(calls)).toEqual([
      {
        raw: 'intent list',
        executable: 'intent',
        action: 'list',
        source: 'tool-call',
      },
      {
        raw: 'pnpm exec intent load @tanstack/router#routing',
        executable: 'pnpm exec intent',
        action: 'load',
        skillUse: '@tanstack/router#routing',
        source: 'tool-call',
      },
      {
        raw: 'npx @tanstack/intent load @tanstack/start#routing',
        executable: 'npx @tanstack/intent',
        action: 'load',
        skillUse: '@tanstack/start#routing',
        source: 'tool-call',
      },
      {
        raw: 'npx @tanstack/intent@latest load @tanstack/router#routing',
        executable: 'npx @tanstack/intent@latest',
        action: 'load',
        skillUse: '@tanstack/router#routing',
        source: 'tool-call',
      },
      {
        raw: 'pnpm dlx @tanstack/intent@latest load @tanstack/router#routing',
        executable: 'pnpm dlx @tanstack/intent@latest',
        action: 'load',
        skillUse: '@tanstack/router#routing',
        source: 'tool-call',
      },
      {
        raw: 'pnpm dlx @tanstack/intent@latest list',
        executable: 'pnpm dlx @tanstack/intent@latest',
        action: 'list',
        source: 'tool-call',
      },
      {
        raw: 'pnpm dlx @tanstack/intent list',
        executable: 'pnpm dlx @tanstack/intent',
        action: 'list',
        source: 'tool-call',
      },
      {
        raw: 'yarn dlx @tanstack/intent@latest load @tanstack/router#routing',
        executable: 'yarn dlx @tanstack/intent@latest',
        action: 'load',
        skillUse: '@tanstack/router#routing',
        source: 'tool-call',
      },
      {
        raw: 'yarn dlx @tanstack/intent@latest list',
        executable: 'yarn dlx @tanstack/intent@latest',
        action: 'list',
        source: 'tool-call',
      },
      {
        raw: 'yarn dlx @tanstack/intent list',
        executable: 'yarn dlx @tanstack/intent',
        action: 'list',
        source: 'tool-call',
      },
      {
        raw: 'bunx @tanstack/intent@latest load @tanstack/router#routing',
        executable: 'bunx @tanstack/intent@latest',
        action: 'load',
        skillUse: '@tanstack/router#routing',
        source: 'tool-call',
      },
      {
        raw: 'bunx @tanstack/intent@latest list',
        executable: 'bunx @tanstack/intent@latest',
        action: 'list',
        source: 'tool-call',
      },
      {
        raw: 'bunx @tanstack/intent list',
        executable: 'bunx @tanstack/intent',
        action: 'list',
        source: 'tool-call',
      },
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

  it('captures native Copilot skill invocations once', () => {
    const transcript = [
      '\u25cf skill(routing)',
      '',
      '### `skill`',
      '',
      '<details>',
      '<summary>Arguments</summary>',
      '',
      '```json',
      '{',
      '  "skill": "routing"',
      '}',
      '```',
      '</details>',
      'I might mention skill(routing) in prose.',
      '\u2717 skill(v9-columns)',
    ].join('\n')

    expect(nativeSkillNamesFromTranscript(transcript)).toEqual(['routing'])
  })

  it('grades native skill loads only for symlink discovery', () => {
    const run = {
      artifacts: { nativeSkillsLoaded: ['@tanstack/router#routing'] },
      errors: [],
      output: {},
      session: { messages: [] },
      usage: {},
    }

    expect(correctSkillLoaded(run, ['router'], 'symlink-intent')).toEqual({
      passed: true,
      loadedSkills: ['@tanstack/router#routing'],
    })
    expect(correctSkillLoaded(run, ['start'], 'symlink-intent').passed).toBe(
      false,
    )
    expect(correctSkillLoaded(run, ['router'], 'mapped-intent').passed).toBe(
      false,
    )
    expect(discoveryInvocation(run, 'symlink-intent').passed).toBe(true)
    expect(discoveryInvocation(run, 'mapped-intent').passed).toBe(false)
    expect(discoveryInvocation(run, 'hooked-intent').passed).toBe(false)
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
      referenceOnly(
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
      ),
    ).toBe(false)
  })

  it('prepares an isolated workspace for every task fixture', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'intent-eval-fixtures-'))

    try {
      for (const task of tasks) {
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
    hookCatalogInjected?: boolean
    hookCatalogInjections?: number
    intentLoads?: Array<string>
  } = {},
) {
  const hookCatalogInjections =
    overrides.hookCatalogInjections ??
    (overrides.hookCatalogInjected === true ? 1 : 0)

  return {
    id,
    kind,
    catalogCommands: overrides.catalogCommands ?? [],
    expectedSkillArea: overrides.expectedSkillArea,
    hookCatalogInjected: hookCatalogInjections > 0,
    hookCatalogInjections,
    intentLoads: overrides.intentLoads ?? [],
    nativeSkills: [],
    runnerCompleted: true,
    taskPassed: true,
  }
}
