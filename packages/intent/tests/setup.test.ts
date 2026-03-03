import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSetup } from '../src/setup.js'

let root: string
let metaDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'setup-test-'))
  metaDir = join(root, 'meta')

  // Create mock templates
  mkdirSync(join(metaDir, 'templates', 'workflows'), { recursive: true })
  mkdirSync(join(metaDir, 'templates', 'oz'), { recursive: true })

  writeFileSync(
    join(metaDir, 'templates', 'workflows', 'notify-intent.yml'),
    'package: {{PACKAGE_NAME}}\nrepo: {{REPO}}\ndocs: {{DOCS_PATH}}\nsrc: {{SRC_PATH}}',
  )
  writeFileSync(
    join(metaDir, 'templates', 'oz', 'domain-discovery.md'),
    '# Discovery for {{PACKAGE_NAME}}\nRepo: {{REPO}}',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('runSetup', () => {
  it('copies workflow and oz templates with defaults', () => {
    const result = runSetup(root, metaDir, [])
    expect(result.workflows).toHaveLength(1)
    expect(result.oz).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)

    const wfPath = join(root, '.github', 'workflows', 'notify-intent.yml')
    expect(existsSync(wfPath)).toBe(true)
    const content = readFileSync(wfPath, 'utf8')
    expect(content).toContain('package: unknown')
  })

  it('substitutes variables from package.json intent field', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@tanstack/query',
        intent: { repo: 'TanStack/query', docs: 'docs/' },
      }),
    )

    const result = runSetup(root, metaDir, [])
    const wfContent = readFileSync(
      join(root, '.github', 'workflows', 'notify-intent.yml'),
      'utf8',
    )
    expect(wfContent).toContain('package: @tanstack/query')
    expect(wfContent).toContain('repo: TanStack/query')
    expect(wfContent).toContain('docs: docs/**')
  })

  it('only copies workflows with --workflows flag', () => {
    const result = runSetup(root, metaDir, ['--workflows'])
    expect(result.workflows).toHaveLength(1)
    expect(result.oz).toHaveLength(0)
  })

  it('only copies oz with --oz flag', () => {
    const result = runSetup(root, metaDir, ['--oz'])
    expect(result.workflows).toHaveLength(0)
    expect(result.oz).toHaveLength(1)
  })

  it('copies both with --all flag', () => {
    const result = runSetup(root, metaDir, ['--all'])
    expect(result.workflows).toHaveLength(1)
    expect(result.oz).toHaveLength(1)
  })

  it('skips existing files', () => {
    // First run
    runSetup(root, metaDir, [])
    // Second run
    const result = runSetup(root, metaDir, [])
    expect(result.workflows).toHaveLength(0)
    expect(result.oz).toHaveLength(0)
    expect(result.skipped).toHaveLength(3)
  })

  it('handles missing templates directory gracefully', () => {
    const emptyMeta = join(root, 'empty-meta')
    mkdirSync(emptyMeta)
    const result = runSetup(root, emptyMeta, [])
    expect(result.workflows).toHaveLength(0)
    expect(result.oz).toHaveLength(0)
  })
})
