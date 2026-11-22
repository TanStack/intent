import { describe, expect, it } from 'vitest'
import {
  EDIT_TOOLS_BY_AGENT,
  GATE_DENY_REASON,
  parseIntentInvocation,
} from '../src/hooks/policy.js'

describe('intent hook policy', () => {
  it('parses intent load and list invocations across runners', () => {
    expect(
      parseIntentInvocation(
        'npx @tanstack/intent@latest load @tanstack/router#routing',
      ),
    ).toEqual({ action: 'load', skillUse: '@tanstack/router#routing' })
    expect(parseIntentInvocation('intent list')).toEqual({ action: 'list' })
    expect(
      parseIntentInvocation('cd packages/app && intent load @tanstack/x#y'),
    ).toEqual({ action: 'load', skillUse: '@tanstack/x#y' })
    expect(
      parseIntentInvocation('npm test || intent load @tanstack/x#y'),
    ).toEqual({ action: 'load', skillUse: '@tanstack/x#y' })
  })

  it('parses the project bin shim the session catalog suggests', () => {
    expect(
      parseIntentInvocation('node_modules/.bin/intent load @tanstack/x#y'),
    ).toEqual({ action: 'load', skillUse: '@tanstack/x#y' })
    expect(parseIntentInvocation('./node_modules/.bin/intent list')).toEqual({
      action: 'list',
    })
    expect(
      parseIntentInvocation(
        'cd packages/app && ../../node_modules/.bin/intent load @tanstack/x#y',
      ),
    ).toEqual({ action: 'load', skillUse: '@tanstack/x#y' })
    expect(
      parseIntentInvocation('node_modules\\.bin\\intent load @tanstack/x#y'),
    ).toEqual({ action: 'load', skillUse: '@tanstack/x#y' })
    expect(
      parseIntentInvocation('my-intent load @tanstack/x#y'),
    ).toBeUndefined()
  })

  it('ignores non-intent commands and incomplete load commands', () => {
    expect(parseIntentInvocation('npm run build')).toBeUndefined()
    expect(
      parseIntentInvocation('echo intent load @tanstack/router#routing'),
    ).toBeUndefined()
    expect(
      parseIntentInvocation('# intent load @tanstack/router#routing'),
    ).toBeUndefined()
    expect(parseIntentInvocation('intent load')).toBeUndefined()
    expect(parseIntentInvocation(undefined)).toBeUndefined()
  })

  it('lists the edit tools gated per agent', () => {
    expect(EDIT_TOOLS_BY_AGENT.copilot.has('Write')).toBe(true)
    expect(EDIT_TOOLS_BY_AGENT.claude.has('Edit')).toBe(true)
    expect(EDIT_TOOLS_BY_AGENT.codex.has('apply_patch')).toBe(true)
  })

  it('keeps the deny reason free of parseable intent commands', () => {
    expect(parseIntentInvocation(GATE_DENY_REASON)).toBeUndefined()
    expect(/intent\s+(list|load)/i.test(GATE_DENY_REASON)).toBe(false)
  })
})
