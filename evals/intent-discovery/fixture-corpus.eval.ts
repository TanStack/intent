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
  liveSessionTurns,
} from './corpus/live-sessions'
import { tasks } from './corpus/tasks'
import { validateSessionTurn } from './harness/validate-session-turn'
import type { IntentDiscoveryFixtureDefinition } from './corpus/fixtures'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('Intent discovery fixture corpus', () => {
  it('has source files for every declared fixture', () => {
    for (const fixture of Object.values(fixtures)) {
      for (const file of fixture.files) {
        expect(
          existsSync(join(fixturesDir, fixture.id, file)),
          `${fixture.id} is missing ${file}`,
        ).toBe(true)
      }
    }
  })

  it('points each task at a fixture that covers its expected skill areas', () => {
    for (const task of tasks) {
      const fixture = (
        fixtures as Partial<Record<string, IntentDiscoveryFixtureDefinition>>
      )[task.fixture]

      expect(fixture, `${task.id} uses an unknown fixture`).toBeDefined()
      if (!fixture) {
        continue
      }

      expect(
        task.expectedSkillAreas.every((area) =>
          fixture.skillAreas.includes(area),
        ),
        `${task.id} expects ${task.expectedSkillAreas.join(', ')} but ${fixture.id} covers ${fixture.skillAreas.join(', ')}`,
      ).toBe(true)
    }
  })

  it('defines five paired profiles across three five-turn sessions', () => {
    expect(liveSessionProfiles).toHaveLength(5)
    expect(liveSessionTurns).toHaveLength(5)
    expect(liveSessionCases).toHaveLength(15)
    expect(
      liveSessionCases.every(
        (session) =>
          session.fixture === 'multi-turn' && session.turns.length === 5,
      ),
    ).toBe(true)
    expect(
      liveSessionTurns.every(
        (turn) => !/\bintent\b|\bskill\b|\bcatalog\b/i.test(turn.prompt),
      ),
    ).toBe(true)
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
})
