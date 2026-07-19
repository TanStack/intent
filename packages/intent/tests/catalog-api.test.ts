import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getIntentCatalogContext,
  runSessionCatalogueHook,
} from '../src/catalog.js'

const tempDirs: Array<string> = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name))
  tempDirs.push(root)
  return root
}

describe('getIntentCatalogContext', () => {
  it('returns agent-safe context and diagnostics without command output', async () => {
    const root = tempRoot('intent-catalog-api-')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'catalog-api', private: true }),
    )
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await getIntentCatalogContext({ cwd: root, refresh: true })

    expect(result.context).toContain(
      'TanStack Intent: no available skills for this workspace.',
    )
    expect(result.cacheStatus).toBe('miss')
    expect(result.diagnostics).toMatchObject({
      discoveryPackageJsonReadCount: 1,
      packageCount: 0,
      skillCount: 0,
      sizeBytes: Buffer.byteLength(result.context),
    })
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  it('reuses cached context without running discovery again', async () => {
    const root = tempRoot('intent-catalog-api-cache-')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'catalog-api-cache', private: true }),
    )

    const first = await getIntentCatalogContext({ cwd: root, refresh: true })
    const second = await getIntentCatalogContext({ cwd: root })

    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('hit')
    expect(second.context).toBe(first.context)
    expect(second.diagnostics.discoveryPackageJsonReadCount).toBe(0)
  })
})

describe('runSessionCatalogueHook', () => {
  it('writes Claude session context in the documented output shape', async () => {
    const root = tempRoot('intent-catalog-hook-claude-')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'catalog-hook-claude', private: true }),
    )
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runSessionCatalogueHook({
      agent: 'claude',
      event: {
        cwd: root,
        hook_event_name: 'SessionStart',
        session_id: 'session-a',
        source: 'startup',
      },
    })

    expect(stdout).toHaveBeenCalledOnce()
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringContaining('TanStack Intent:'),
      },
    })
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('[intent catalog] SessionStart'),
    )
  })

  it('writes Copilot context in its flat output shape', async () => {
    const root = tempRoot('intent-catalog-hook-copilot-')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'catalog-hook-copilot', private: true }),
    )
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await runSessionCatalogueHook({
      agent: 'copilot',
      event: { cwd: root, sessionId: 'session-a', source: 'startup' },
    })

    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
      additionalContext: expect.stringContaining('TanStack Intent:'),
    })
  })

  it('ignores non-lifecycle events', async () => {
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runSessionCatalogueHook({
      agent: 'codex',
      event: { hook_event_name: 'PreToolUse' },
    })

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  it('ignores Copilot non-lifecycle payloads without an agent name', async () => {
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runSessionCatalogueHook({
      agent: 'copilot',
      event: { cwd: process.cwd(), toolName: 'edit' },
    })

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  it('fails open when hook event processing throws', async () => {
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = Object.defineProperty({}, 'hook_event_name', {
      get() {
        throw new Error('event failure')
      },
    })

    await expect(
      runSessionCatalogueHook({ agent: 'claude', event }),
    ).resolves.toBeUndefined()
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(
      '[intent catalog] hook failed open: event failure',
    )
  })
})
