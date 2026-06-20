import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fixtures } from './corpus/fixtures'
import { tasks } from './corpus/tasks'
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
})
