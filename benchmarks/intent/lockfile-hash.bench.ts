import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, bench, describe } from 'vitest'
import { computeSkillContentHash } from '../../packages/intent/src/core/lockfile/hash.js'
import { createTempDir, writeFile } from './helpers.js'

const root = createTempDir('lockfile-hash')
const skillDir = join(root, 'skills', 'representative')

beforeAll(() => {
  writeFile(join(skillDir, 'SKILL.md'), '# Guidance\n'.repeat(200))
  writeFile(join(skillDir, 'references', 'api.md'), '# API\n'.repeat(200))
  writeFile(join(skillDir, 'assets', 'example.json'), '{"enabled":true}\n')
  writeFile(join(skillDir, 'scripts', 'check.mjs'), 'process.exit(0)\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('per-skill lock hashing', () => {
  bench('hashes a representative skill folder', () => {
    computeSkillContentHash({ packageRoot: root, skillDir })
  })
})
