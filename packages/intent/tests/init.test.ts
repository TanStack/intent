import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectAgentConfigs,
  hasIntentBlock,
  injectIntentBlock,
  readProjectConfig,
  runInit,
  writeProjectConfig,
} from '../src/init.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'init-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('detectAgentConfigs', () => {
  it('detects AGENTS.md', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Agents')
    const found = detectAgentConfigs(root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('AGENTS.md')
  })

  it('detects CLAUDE.md', () => {
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude')
    const found = detectAgentConfigs(root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('CLAUDE.md')
  })

  it('detects .cursorrules', () => {
    writeFileSync(join(root, '.cursorrules'), 'rules')
    const found = detectAgentConfigs(root)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('.cursorrules')
  })

  it('detects multiple configs', () => {
    writeFileSync(join(root, 'AGENTS.md'), '')
    writeFileSync(join(root, 'CLAUDE.md'), '')
    const found = detectAgentConfigs(root)
    expect(found).toHaveLength(2)
  })

  it('returns empty when no configs found', () => {
    const found = detectAgentConfigs(root)
    expect(found).toHaveLength(0)
  })
})

describe('injectIntentBlock', () => {
  it('injects block into existing file', () => {
    const filePath = join(root, 'AGENTS.md')
    writeFileSync(filePath, '# Agent Instructions\n\nSome existing content.\n')

    const injected = injectIntentBlock(filePath)
    expect(injected).toBe(true)

    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('## Intent Skills')
    expect(content).toContain('npx intent list')
    expect(content).toContain('Some existing content.')
  })

  it('is idempotent — skips if block already present', () => {
    const filePath = join(root, 'AGENTS.md')
    writeFileSync(filePath, '# Agent\n\n## Intent Skills\n\nAlready here.\n')

    const injected = injectIntentBlock(filePath)
    expect(injected).toBe(false)
  })

  it('works on empty file', () => {
    const filePath = join(root, 'CLAUDE.md')
    writeFileSync(filePath, '')

    const injected = injectIntentBlock(filePath)
    expect(injected).toBe(true)

    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('## Intent Skills')
  })
})

describe('hasIntentBlock', () => {
  it('returns true when block exists', () => {
    const filePath = join(root, 'test.md')
    writeFileSync(filePath, '## Intent Skills\n\nContent.')
    expect(hasIntentBlock(filePath)).toBe(true)
  })

  it('returns false when block missing', () => {
    const filePath = join(root, 'test.md')
    writeFileSync(filePath, '# No intent here')
    expect(hasIntentBlock(filePath)).toBe(false)
  })

  it('returns false for non-existent file', () => {
    expect(hasIntentBlock(join(root, 'nope.md'))).toBe(false)
  })
})

describe('writeProjectConfig', () => {
  it('creates intent.config.json with defaults', () => {
    const configPath = writeProjectConfig(root)
    expect(existsSync(configPath)).toBe(true)

    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config.feedback.frequency).toBe('every-5')
  })

  it('does not overwrite existing config', () => {
    const configPath = join(root, 'intent.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({ feedback: { frequency: 'never' } }),
    )

    writeProjectConfig(root)
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config.feedback.frequency).toBe('never')
  })
})

describe('readProjectConfig', () => {
  it('reads existing config', () => {
    writeFileSync(
      join(root, 'intent.config.json'),
      JSON.stringify({ feedback: { frequency: 'always' } }),
    )
    const config = readProjectConfig(root)
    expect(config?.feedback.frequency).toBe('always')
  })

  it('returns null when no config exists', () => {
    expect(readProjectConfig(root)).toBeNull()
  })
})

describe('runInit', () => {
  it('injects into all detected configs and creates project config', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Agents\n')
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude\n')

    const result = runInit(root)

    expect(result.injected).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)
    expect(existsSync(result.configPath)).toBe(true)

    // Verify injection happened
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain(
      '## Intent Skills',
    )
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain(
      '## Intent Skills',
    )
  })

  it('skips already-initialized files', () => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      '## Intent Skills\n\nAlready done.\n',
    )

    const result = runInit(root)
    expect(result.injected).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
  })

  it('handles mixed state (some initialized, some not)', () => {
    writeFileSync(join(root, 'AGENTS.md'), '## Intent Skills\n\nDone.\n')
    writeFileSync(join(root, 'CLAUDE.md'), '# Fresh\n')

    const result = runInit(root)
    expect(result.injected).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })
})
