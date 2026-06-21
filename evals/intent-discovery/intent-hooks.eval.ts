import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EDIT_TOOLS,
  GATE_DENY_REASON,
  gateDecision,
  hasLoadFromObservations,
  observationFromEvent,
  parseIntentInvocation,
} from './harness/intent-hooks/hook-core.mjs'
import { applyIntentCondition } from './harness/setup-intent-condition'
import { prepareFixtureWorkspace } from './harness/prepare-fixture'

describe('intent hook core', () => {
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

  it('ignores non-intent commands and load without a skill use', () => {
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

  it('observes intent commands only from Bash tool calls', () => {
    expect(
      observationFromEvent({
        tool_name: 'Bash',
        tool_input: { command: 'intent load @tanstack/router#routing' },
      }),
    ).toEqual({
      action: 'load',
      skillUse: '@tanstack/router#routing',
      raw: 'intent load @tanstack/router#routing',
    })
    expect(
      observationFromEvent({
        tool_name: 'Edit',
        tool_input: { command: 'intent load @tanstack/router#routing' },
      }),
    ).toBeUndefined()
    expect(
      observationFromEvent({
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
      }),
    ).toBeUndefined()
  })

  it('denies edits until a load is observed, allows shell tools', () => {
    expect(gateDecision({ toolName: 'Edit', hasLoaded: false })).toEqual({
      decision: 'deny',
      reason: GATE_DENY_REASON,
    })
    expect(gateDecision({ toolName: 'Write', hasLoaded: false })).toEqual({
      decision: 'deny',
      reason: GATE_DENY_REASON,
    })
    expect(gateDecision({ toolName: 'Edit', hasLoaded: true })).toEqual({
      decision: 'allow',
    })
    expect(gateDecision({ toolName: 'Bash', hasLoaded: false })).toEqual({
      decision: 'allow',
    })
    expect(EDIT_TOOLS.has('Write')).toBe(true)
    expect(EDIT_TOOLS.has('Edit')).toBe(true)
  })

  it('detects a prior load from observation records', () => {
    expect(hasLoadFromObservations([{ action: 'list' }])).toBe(false)
    expect(
      hasLoadFromObservations([{ action: 'list' }, { action: 'load' }]),
    ).toBe(true)
  })

  it('keeps the deny reason free of parseable intent commands', () => {
    expect(parseIntentInvocation(GATE_DENY_REASON)).toBeUndefined()
    expect(/intent\s+(list|load)/i.test(GATE_DENY_REASON)).toBe(false)
  })
})

describe('hooked-intent condition setup', () => {
  it('writes the mapped guidance block the gate points to', () => {
    const prepared = prepareFixtureWorkspace({ fixture: 'router-basic' })

    try {
      applyIntentCondition({
        condition: 'hooked-intent',
        expectedSkillAreas: ['router'],
        workspacePath: prepared.workspacePath,
      })
      const agents = readFileSync(
        join(prepared.workspacePath, 'AGENTS.md'),
        'utf8',
      )

      expect(agents).toContain('tanstackIntent:')
      expect(agents).toContain('id: "@tanstack/router#routing"')
      expect(agents).toContain(
        'run: "npx @tanstack/intent@latest load @tanstack/router#routing"',
      )
    } finally {
      prepared.cleanup()
    }
  })
})
