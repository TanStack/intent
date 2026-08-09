import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fixtures } from './corpus/fixtures'
import {
  liveSessionCases,
  liveSessionProfiles,
  liveSessionRepetitionCount,
  liveSessionTurns,
} from './corpus/live-sessions'
import { savedTranscriptCases } from './fixtures/saved-transcripts'
import { validateSessionTurn } from './harness/validate-session-turn'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('Intent discovery fixture corpus', () => {
  it('has source files for every declared fixture', () => {
    for (const [fixtureId, fixture] of Object.entries(fixtures)) {
      for (const file of fixture.files) {
        expect(
          existsSync(join(fixturesDir, fixtureId, file)),
          `${fixtureId} is missing ${file}`,
        ).toBe(true)
      }
    }
  })

  it('points each task at a fixture that covers its expected skill areas', () => {
    for (const task of savedTranscriptCases) {
      const fixture = fixtures[task.fixture]

      expect(
        task.expectedSkillAreas.every((area) =>
          fixture.skillAreas.includes(area),
        ),
        `${task.id} expects ${task.expectedSkillAreas.join(', ')} but ${task.fixture} covers ${fixture.skillAreas.join(', ')}`,
      ).toBe(true)
    }
  })

  it('defines eight paired profiles across six six-turn conditions', () => {
    expect(liveSessionProfiles).toHaveLength(8)
    expect(liveSessionTurns).toHaveLength(6)
    expect(liveSessionCases).toHaveLength(48)
    expect(
      liveSessionCases.every(
        (session) =>
          session.fixture === 'multi-turn' && session.turns.length === 6,
      ),
    ).toBe(true)
    expect(
      liveSessionTurns.every(
        (turn) => !/\bintent\b|\bskill\b|\bcatalog\b/i.test(turn.prompt),
      ),
    ).toBe(true)

    for (const profile of liveSessionProfiles) {
      const cases = liveSessionCases.filter(
        (session) => session.profile.id === profile.id,
      )
      expect(cases.map((session) => session.condition).sort()).toEqual([
        'hooked-exact-intent',
        'hooked-intent',
        'mapped-exact-intent',
        'mapped-intent',
        'no-intent',
        'symlink-intent',
      ])
      expect(
        new Set(
          cases.map((session) =>
            session.turns.map((turn) => turn.id).join(','),
          ),
        ).size,
      ).toBe(1)
    }

    expect(
      liveSessionTurns.some(
        (turn) => turn.id === 'table-heading' && turn.kind === 'unrelated',
      ),
    ).toBe(true)
  })

  it.each([
    ['3', 3],
    ['0', 1],
    ['-1', 1],
    ['Infinity', 1],
    ['invalid', 1],
  ])('uses %s as %i live repetitions', (value, expected) => {
    expect(liveSessionRepetitionCount(value)).toBe(expected)
  })

  it('starts every multi-turn task incomplete', () => {
    const workspacePath = join(fixturesDir, 'multi-turn')

    for (const turn of liveSessionTurns) {
      expect(
        validateSessionTurn(workspacePath, turn).passed,
        `${turn.id} should require an agent change`,
      ).toBe(false)
    }
  })

  it('accepts valid router loader source independent of local names and hook form', () => {
    const workspacePath = mkdtempSync(
      join(tmpdir(), 'intent-router-validation-'),
    )
    const routesPath = join(workspacePath, 'src/routes')
    mkdirSync(routesPath, { recursive: true })
    writeFileSync(
      join(routesPath, 'users.$userId.tsx'),
      `
        import { createFileRoute, useLoaderData } from '@tanstack/react-router'

        export const Route = createFileRoute('/users/$userId')({
          loader: async ({ params }) => {
            const res = await fetch(\`/api/users/\${params.userId}\`)
            if (!res.ok) throw new Error('Unable to load user')
            return res.json()
          },
          component: UserRoute,
        })

        function UserRoute() {
          const user = useLoaderData({ from: '/users/$userId' })
          return <h1>{user.name}</h1>
        }
      `,
    )

    try {
      expect(
        validateSessionTurn(
          workspacePath,
          liveSessionTurns.find((turn) => turn.validation === 'router')!,
        ),
      ).toEqual({ passed: true, reason: 'passed' })
    } finally {
      rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('accepts controlled table sorting state formatted across lines', () => {
    const workspacePath = mkdtempSync(
      join(tmpdir(), 'intent-table-validation-'),
    )
    const sourcePath = join(workspacePath, 'src')
    mkdirSync(sourcePath, { recursive: true })
    writeFileSync(
      join(sourcePath, 'user-table.tsx'),
      `
        import { useState } from 'react'
        import {
          getSortedRowModel,
          type SortingState,
          useReactTable,
        } from '@tanstack/react-table'

        function UserTable() {
          const [sorting, setSorting] = useState<SortingState>([])
          const table = useReactTable({
            data: [],
            columns: [],
            state: {
              sorting,
            },
            onSortingChange: setSorting,
            getSortedRowModel: getSortedRowModel(),
          })
          const roleColumn = table.getColumn('role')

          return <button onClick={roleColumn?.getToggleSortingHandler()} />
        }
      `,
    )

    try {
      expect(
        validateSessionTurn(
          workspacePath,
          liveSessionTurns.find((turn) => turn.validation === 'table-v9')!,
        ),
      ).toEqual({ passed: true, reason: 'passed' })
    } finally {
      rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('rejects framework keywords that are not wired into executable code', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'intent-ast-validation-'))
    const routesPath = join(workspacePath, 'src/routes')
    mkdirSync(routesPath, { recursive: true })
    writeFileSync(
      join(routesPath, 'users.$userId.tsx'),
      '/* loader: /api/users/userId response.ok Unable to load user useLoaderData( */',
    )
    writeFileSync(
      join(routesPath, 'users.tsx'),
      "/* createServerFn method: 'GET' .handler( loader: Route.useLoaderData() */",
    )
    writeFileSync(
      join(workspacePath, 'src/user-table.tsx'),
      '/* SortingState onSortingChange state: { sorting } getSortedRowModel getToggleSortingHandler */',
    )

    try {
      for (const validation of ['router', 'start', 'table-v9'] as const) {
        expect(
          validateSessionTurn(
            workspacePath,
            liveSessionTurns.find((turn) => turn.validation === validation)!,
          ).passed,
          `${validation} should require executable structure`,
        ).toBe(false)
      }
    } finally {
      rmSync(workspacePath, { recursive: true, force: true })
    }
  })
})
