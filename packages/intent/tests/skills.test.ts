import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runValidateCommand } from '../src/commands/validate.js'
import { findSkillFiles } from '../src/shared/utils.js'

const META_DIR = join(__dirname, '..', 'meta')

describe('shipped meta-skills', () => {
  it('keeps every existing meta command available', () => {
    const names = findSkillFiles(META_DIR).map((file) =>
      relative(META_DIR, file).split(sep).slice(0, -1).join('/'),
    )
    expect(names.sort()).toEqual([
      'domain-discovery',
      'generate-skill',
      'skill-staleness-check',
      'tree-generator',
    ])
  })

  it('passes the same validator used by library maintainers', async () => {
    await runValidateCommand(META_DIR)
  })
})
