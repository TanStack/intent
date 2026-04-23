import { afterEach, describe, expect, it, vi } from 'vitest'
import { runStaleCommand } from '../src/commands/stale.js'

describe('runStaleCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

  afterEach(() => {
    logSpy.mockClear()
  })

  it('prints review signals in non-json output', async () => {
    await runStaleCommand(undefined, {}, async () => ({
      reports: [
        {
          library: '@tanstack/router',
          currentVersion: '1.0.0',
          skillVersion: '1.0.0',
          versionDrift: null,
          skills: [],
          signals: [
            {
              type: 'missing-package-coverage',
              library: '@tanstack/router',
              packageName: '@tanstack/react-start-rsc',
              reasons: ['package is not represented in skills or artifacts'],
              needsReview: true,
            },
          ],
        },
      ],
    }))

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('@tanstack/router')
    expect(output).toContain('@tanstack/react-start-rsc')
    expect(output).toContain('package is not represented')
    expect(output).not.toContain('All skills up-to-date')
  })
})
