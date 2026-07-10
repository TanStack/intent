import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFileSync: (...args: Array<unknown>) => execFileSyncMock(...args),
}))

const { currentBlobSha } = await import('../src/core/git-adapter.js')

const roots: Array<string> = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'git-adapter-failure-test-'))
  roots.push(root)
  writeFileSync(join(root, 'file.txt'), 'content')
  return root
}

afterEach(() => {
  execFileSyncMock.mockReset()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('currentBlobSha failures', () => {
  it('propagates an unexpected Git failure for an existing file', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('git failed unexpectedly')
    })

    const result = currentBlobSha(createRoot(), 'file.txt')

    expect(result).toEqual({ ok: false, reason: 'git failed unexpectedly' })
  })

  it('runs Git with bounded output and a timeout', () => {
    execFileSyncMock.mockReturnValue('0123456789abcdef\n')

    const result = currentBlobSha(createRoot(), 'file.txt')

    expect(result).toEqual({ ok: true, value: '0123456789abcdef' })
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'git',
      ['hash-object', '--', 'file.txt'],
      expect.objectContaining({ maxBuffer: 1024 * 1024, timeout: 10_000 }),
    )
  })
})
