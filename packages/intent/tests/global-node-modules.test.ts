import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFileSync: (...args: Array<unknown>) => execFileSyncMock(...args),
}))

const { detectGlobalNodeModules } = await import('../src/shared/utils.js')

afterEach(() => {
  vi.unstubAllEnvs()
  delete process.env.INTENT_GLOBAL_NODE_MODULES
  execFileSyncMock.mockReset()
})

describe('detectGlobalNodeModules', () => {
  it('shells out to the package manager outside frozen mode', () => {
    execFileSyncMock.mockReturnValue('/global/pnpm/node_modules')

    const result = detectGlobalNodeModules('pnpm')

    expect(execFileSyncMock).toHaveBeenCalled()
    expect(result.path).toBe('/global/pnpm/node_modules')
  })

  it('makes no subprocess call in frozen mode', () => {
    vi.stubEnv('INTENT_FROZEN', '1')

    const result = detectGlobalNodeModules('pnpm')

    expect(execFileSyncMock).not.toHaveBeenCalled()
    expect(result).toEqual({ path: null })
  })

  it('still honors INTENT_GLOBAL_NODE_MODULES override in frozen mode', () => {
    vi.stubEnv('INTENT_FROZEN', '1')
    process.env.INTENT_GLOBAL_NODE_MODULES = '/override/node_modules'

    const result = detectGlobalNodeModules('pnpm')

    expect(execFileSyncMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      path: '/override/node_modules',
      source: 'INTENT_GLOBAL_NODE_MODULES',
    })
  })
})
