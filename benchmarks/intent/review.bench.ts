import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import {
  createCliFixture,
  createSlowBenchOptions,
  git,
  writeFile,
  writeJson,
  writeSkill,
} from './helpers.ts'

const skillCount = 20

function createReviewFixture(sourcesFor: (index: number) => string) {
  return createCliFixture('review', async (root, capture) => {
    writeJson(join(root, 'package.json'), {
      name: '@bench/library',
      version: '1.0.0',
    })
    for (let index = 0; index < skillCount; index++) {
      for (const file of ['index', 'options', 'errors']) {
        writeFile(
          join(root, 'src', `feature-${index}`, `${file}.ts`),
          `export const ${file}${index} = ${index}\n`,
        )
      }
      writeSkill(root, `feature-${index}`, {
        description: `Use for feature ${index}.`,
        sources: [sourcesFor(index)],
      })
    }
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'fixture')

    const report = JSON.parse(await capture(['review', '--json'])) as {
      items: Array<{ problems: Array<string> }>
    }
    if (
      report.items.length !== skillCount ||
      report.items.some((item) => item.problems.length > 0)
    ) {
      throw new Error(`Unexpected review report: ${JSON.stringify(report)}`)
    }
  })
}

const distinctSources = createReviewFixture(
  (index) => `src/feature-${index}/**`,
)
const sharedSources = createReviewFixture(() => 'src/**/*.ts')

describe('intent review with distinct sources per skill', () => {
  beforeAll(distinctSources.setup)
  afterAll(distinctSources.teardown)

  bench(
    'reports every pending skill as json',
    async () => {
      await distinctSources.run(['review', '--json'])
    },
    createSlowBenchOptions(distinctSources.setup, distinctSources.teardown),
  )
})

describe('intent review with one source pattern shared by every skill', () => {
  beforeAll(sharedSources.setup)
  afterAll(sharedSources.teardown)

  bench(
    'reuses source matches and hashes across skills',
    async () => {
      await sharedSources.run(['review', '--json'])
    },
    createSlowBenchOptions(sharedSources.setup, sharedSources.teardown),
  )
})
