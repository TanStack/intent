import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../src/utils.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'intent-parse-frontmatter-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(name: string, content: string): string {
  const path = join(root, name)
  writeFileSync(path, content)
  return path
}

describe('parseFrontmatter', () => {
  it('parses frontmatter from a small file', () => {
    const path = write(
      'small.md',
      '---\nname: core\ndescription: A skill\n---\n\nBody.\n',
    )

    expect(parseFrontmatter(path)).toEqual({
      name: 'core',
      description: 'A skill',
    })
  })

  it('parses frontmatter without reading a large body', () => {
    const body = 'x'.repeat(64 * 1024)
    const path = write('large-body.md', `---\nname: big\n---\n\n${body}\n`)

    expect(parseFrontmatter(path)).toEqual({ name: 'big' })
  })

  it('parses frontmatter that exceeds the bounded read probe', () => {
    const longValue = 'y'.repeat(32 * 1024)
    const path = write(
      'large-frontmatter.md',
      `---\nname: big\ndescription: ${longValue}\n---\n\nBody.\n`,
    )

    expect(parseFrontmatter(path)).toEqual({
      name: 'big',
      description: longValue,
    })
  })

  it('returns null when there is no frontmatter', () => {
    const path = write('none.md', '# Just a heading\n\nNo frontmatter here.\n')

    expect(parseFrontmatter(path)).toBeNull()
  })

  it('returns null for a missing file', () => {
    expect(parseFrontmatter(join(root, 'does-not-exist.md'))).toBeNull()
  })
})
