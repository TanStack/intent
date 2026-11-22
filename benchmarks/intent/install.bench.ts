import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createBenchOptions,
  createCliFixture,
  writeJson,
  writePackage,
} from './helpers.ts'

const scopeCount = 40
const skillsPerPackage = 5

const reviewRuntime = {
  isTTY: true,
  permissionPrompts: {
    selectPermissions: () => Promise.resolve(null),
    reviewPermissions: () => Promise.resolve(null),
    editPermissions: (_packages: unknown, selection: unknown) =>
      Promise.resolve(selection),
    confirmWrite: () => Promise.resolve(true),
  },
}

const fixture = createCliFixture('install-review', async (root, capture) => {
  const dependencies: Record<string, string> = {}
  for (let index = 0; index < scopeCount; index++) {
    const name = `@bench-scope-${index}/library`
    dependencies[name] = '1.0.0'
    writePackage(join(root, 'node_modules'), name, '1.0.0', {
      skills: Array.from(
        { length: skillsPerPackage },
        (_, skill) => `topic-${skill}`,
      ),
    })
  }
  writeJson(join(root, 'package.json'), {
    name: 'intent-install-review-benchmark',
    private: true,
    dependencies,
    intent: {
      skills: Object.keys(dependencies).map((name) =>
        name.replace(/\/.*/, '/*'),
      ),
    },
  })

  const output = await capture(['install', '--review'], reviewRuntime)
  const expected = `Available: ${scopeCount * skillsPerPackage} skills from ${scopeCount} packages.`
  if (!output.includes(expected)) {
    throw new Error(`Unexpected install review output: ${output}`)
  }
})

describe('intent install --review', () => {
  beforeAll(fixture.setup)
  afterAll(fixture.teardown)

  bench(
    'reviews unchanged permissions with one scan',
    async () => {
      await fixture.run(['install', '--review'], reviewRuntime)
    },
    createBenchOptions(fixture.setup, fixture.teardown),
  )
})
