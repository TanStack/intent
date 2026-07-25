import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import { scanForIntents } from '../../packages/intent/src/discovery/scanner.js'
import { buildCurrentLockfileSources } from '../../packages/intent/src/core/lockfile/lockfile-state.js'
import { writeIntentLockfile } from '../../packages/intent/src/core/lockfile/lockfile.js'
import {
  createCliRunner,
  createConsoleSilencer,
  createTempDir,
  writeFile,
  writeJson,
  writePackage,
} from './helpers.js'

const consoleSilencer = createConsoleSilencer()
const root = createTempDir('catalog')
const runner = createCliRunner({ cwd: root })

const PACKAGES = [
  {
    name: '@bench/query',
    skills: [
      'queries',
      'mutations',
      'invalidation',
      'prefetching',
      'suspense',
      'pagination',
      'optimistic-updates',
      'ssr-hydration',
    ],
  },
  {
    name: '@bench/router',
    skills: [
      'routing',
      'loaders',
      'search-params',
      'navigation',
      'code-splitting',
      'route-masking',
      'not-found',
    ],
  },
  {
    name: '@bench/table',
    skills: ['columns', 'sorting', 'filtering', 'grouping', 'virtualization'],
  },
]

let getIntentCatalogContext: (options: {
  cwd: string
  refresh?: boolean
}) => Promise<unknown>

beforeAll(async () => {
  consoleSilencer.silence()
  writeJson(join(root, 'package.json'), {
    name: 'intent-catalog-benchmark',
    private: true,
    intent: { skills: ['@bench/*'] },
    dependencies: Object.fromEntries(
      PACKAGES.map((pkg) => [pkg.name, '1.0.0']),
    ),
  })
  writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')
  for (const pkg of PACKAGES) {
    writePackage(join(root, 'node_modules'), pkg.name, '1.0.0', {
      skills: pkg.skills,
    })
  }

  // Without a lockfile the catalogue skips verification entirely, so the warm
  // path would measure an empty loop instead of the per-skill hashing it runs
  // on every session start.
  writeIntentLockfile(join(root, 'intent.lock'), {
    lockfileVersion: 1,
    sources: buildCurrentLockfileSources(
      scanForIntents(root, { scope: 'local' }).packages,
    ),
  })

  await runner.setup()
  const catalog = await import('../../packages/intent/dist/catalog.mjs')
  getIntentCatalogContext = catalog.getIntentCatalogContext
})

afterAll(() => {
  runner.teardown()
  rmSync(root, { recursive: true, force: true })
  consoleSilencer.restore()
})

describe('intent catalog', () => {
  bench('cold catalogue generation through API', async () => {
    await getIntentCatalogContext({ cwd: root, refresh: true })
  })

  bench('warm cached catalogue retrieval through API', async () => {
    await getIntentCatalogContext({ cwd: root })
  })

  bench('warm cached catalogue retrieval through CLI', async () => {
    await runner.run(['catalog', '--json'])
  })
})
