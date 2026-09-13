import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'

let root: string
let previousCwd: string
let log: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  previousCwd = process.cwd()
  root = mkdtempSync(join(tmpdir(), 'intent-maintainer-install-'))
  process.chdir(root)
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  writeFileSync('package.json', '{"name":"library","version":"1.0.0"}\n')
})

afterEach(() => {
  process.chdir(previousCwd)
  log.mockRestore()
  error.mockRestore()
  rmSync(root, { recursive: true, force: true })
})

describe('maintainer installation', () => {
  it('enables authoring without installing consumer permissions or requiring a terminal', async () => {
    const manifest = readFileSync('package.json', 'utf8')
    expect(await main(['install', '--maintainer'], { isTTY: false })).toBe(0)
    const guidance = readFileSync('AGENTS.md', 'utf8')
    expect(guidance).toContain('<!-- intent-maintainer:start -->')
    expect(guidance).toContain('meta generate-skill')
    expect(guidance).toContain('Before substantial library')
    expect(guidance).toContain('review --json')
    expect(guidance).toContain(
      'domain_map.yaml, skill_spec.md, and skill_tree.yaml',
    )
    expect(guidance).not.toContain('<!-- intent-skills:start -->')
    expect(readFileSync('package.json', 'utf8')).toBe(manifest)
    expect(existsSync('node_modules')).toBe(false)
  })

  it('keeps consumer guidance and maintainer guidance through repeated installs', async () => {
    writeFileSync('package.json', '{"name":"library","intent":{"skills":[]}}\n')
    writeFileSync('AGENTS.md', 'Project conventions.\n')
    expect(await main(['install'])).toBe(0)
    const consumer = readFileSync('AGENTS.md', 'utf8')
    expect(await main(['install', '--maintainer'])).toBe(0)
    const combined = readFileSync('AGENTS.md', 'utf8')
    expect(combined).toContain(consumer)
    expect(await main(['install', '--maintainer'])).toBe(0)
    expect(readFileSync('AGENTS.md', 'utf8')).toBe(combined)
    expect(await main(['install'])).toBe(0)
    expect(readFileSync('AGENTS.md', 'utf8')).toBe(combined)
  })

  it('uses the existing managed agent config and preserves its newline style', async () => {
    const original =
      'Rules\r\n<!-- intent-skills:start -->\r\nConsumer guidance\r\n<!-- intent-skills:end -->\r\n'
    writeFileSync('CLAUDE.md', original)
    expect(await main(['install', '--maintainer'])).toBe(0)
    const guidance = readFileSync('CLAUDE.md', 'utf8')
    expect(guidance).toContain(original)
    expect(guidance.replaceAll('\r\n', '')).not.toContain('\n')
    expect(existsSync('AGENTS.md')).toBe(false)
  })

  it('previews package-manager-aware guidance without writing', async () => {
    writeFileSync(
      'package.json',
      '{"name":"library","packageManager":"pnpm@11.9.0"}\n',
    )
    const manifest = readFileSync('package.json', 'utf8')
    expect(await main(['install', '--maintainer', '--dry-run'])).toBe(0)
    expect(log.mock.calls.flat().join('\n')).toContain(
      'pnpm dlx @tanstack/intent@latest meta generate-skill',
    )
    expect(existsSync('AGENTS.md')).toBe(false)
    expect(readFileSync('package.json', 'utf8')).toBe(manifest)
  })

  it('rejects malformed maintainer blocks without modifying them', async () => {
    const original = '<!-- intent-maintainer:start -->\nUnfinished block\n'
    writeFileSync('AGENTS.md', original)
    expect(await main(['install', '--maintainer'])).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain(
      'Invalid intent-maintainer block',
    )
    expect(readFileSync('AGENTS.md', 'utf8')).toBe(original)
  })

  it.each(['--map', '--review', '--print-prompt', '--global', '--global-only'])(
    'rejects %s with maintainer setup before any writes',
    async (option) => {
      expect(
        await main(['install', '--maintainer', option], { isTTY: false }),
      ).toBe(1)
      expect(error.mock.calls.flat().join('\n')).toContain(
        '--maintainer cannot be combined',
      )
      expect(existsSync('AGENTS.md')).toBe(false)
    },
  )
})
