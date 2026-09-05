import { expect, it, vi } from 'vitest'
import * as excludes from '../src/core/excludes.js'
import { selectedPermissionSkills } from '../src/commands/install/permissions.js'

it('compiles permission rules once per selection pass', () => {
  const packages = Array.from({ length: 100 }, (_, i) => ({
    id: `@scope${i}/pkg`,
    version: '1.0.0',
    skills: Array.from({ length: 10 }, (_, j) => ({
      id: `@scope${i}/pkg#skill${j}`,
      name: `skill${j}`,
      description: 'Guidance',
      excluded: false,
    })),
  }))
  const selection = {
    skills: Array.from({ length: 100 }, (_, i) => `@scope${i}/*`),
    exclude: [],
  }
  const compile = vi.spyOn(excludes, 'compileWildcardPattern')
  try {
    expect(selectedPermissionSkills(packages, selection)).toHaveLength(1000)

    expect(compile.mock.calls.length).toBeLessThanOrEqual(100)
  } finally {
    compile.mockRestore()
  }
})
