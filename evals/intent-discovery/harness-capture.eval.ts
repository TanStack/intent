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
import { referenceOnly } from './graders/reference-only'
import {
  intentCommandsFromToolCalls,
  parseIntentCommand,
} from './harness/parse-intent-commands'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'
import type { ToolCallRecord } from 'vitest-evals'

describe('Intent discovery harness capture', () => {
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
