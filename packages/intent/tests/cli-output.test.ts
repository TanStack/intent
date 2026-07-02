import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOW_ALL_NOTICE,
  printNotices,
  printWarnings,
} from '../src/shared/cli-output.js'

const OTHER_NOTICE = 'intent.skills is empty — no skill sources are permitted.'

describe('printNotices — ALLOW_ALL_NOTICE is non-suppressible', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  const previousEnv = process.env.INTENT_NO_NOTICES

  beforeEach(() => {
    delete process.env.INTENT_NO_NOTICES
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    logSpy.mockRestore()
    if (previousEnv === undefined) delete process.env.INTENT_NO_NOTICES
    else process.env.INTENT_NO_NOTICES = previousEnv
  })

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
  }

  it('prints the permit-all banner even when noNotices is set, and suppresses the rest', () => {
    printNotices([OTHER_NOTICE, ALLOW_ALL_NOTICE], { noNotices: true })

    const output = stderr()
    expect(output).toContain(ALLOW_ALL_NOTICE)
    expect(output).not.toContain(OTHER_NOTICE)
  })

  it('prints the permit-all banner even when INTENT_NO_NOTICES=1', () => {
    process.env.INTENT_NO_NOTICES = '1'

    printNotices([OTHER_NOTICE, ALLOW_ALL_NOTICE])

    const output = stderr()
    expect(output).toContain(ALLOW_ALL_NOTICE)
    expect(output).not.toContain(OTHER_NOTICE)
  })

  it('prints every notice when suppression is off', () => {
    printNotices([OTHER_NOTICE, ALLOW_ALL_NOTICE])

    const output = stderr()
    expect(output).toContain(ALLOW_ALL_NOTICE)
    expect(output).toContain(OTHER_NOTICE)
  })

  it('prints nothing when only non-banner notices are suppressed', () => {
    printNotices([OTHER_NOTICE], { noNotices: true })

    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('prints nothing for an empty notice list', () => {
    printNotices([], { noNotices: true })

    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('routes the banner through the notices (stderr) channel, never the warnings channel', () => {
    printNotices([ALLOW_ALL_NOTICE], { noNotices: true })
    printWarnings([])

    expect(stderr()).toContain(ALLOW_ALL_NOTICE)
    const stdout = logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(stdout).not.toContain(ALLOW_ALL_NOTICE)
  })
})
