import { describe, expect, it } from 'vitest'
import { formatClaudePreToolUseOutput } from '../src/hooks/agents/claude.js'
import { formatCodexPreToolUseOutput } from '../src/hooks/agents/codex.js'
import { formatCopilotPreToolUseOutput } from '../src/hooks/agents/copilot.js'
import {
  EDIT_TOOLS_BY_AGENT,
  GATE_DENY_REASON,
  gateDecision,
  hasLoadFromObservations,
  observationFromEvent,
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
        toolName: 'Bash',
        toolArgs: JSON.stringify({ command: 'intent list' }),
      }),
    ).toEqual({ action: 'list', raw: 'intent list', skillUse: undefined })
    expect(
      observationFromEvent({
        tool_name: 'Edit',
        tool_input: { command: 'intent load @tanstack/router#routing' },
      }),
    ).toBeUndefined()
  })

  it('denies edit tools until a load is observed', () => {
    expect(
      gateDecision({ agent: 'copilot', toolName: 'Edit', hasLoaded: false }),
    ).toEqual({ decision: 'deny', reason: GATE_DENY_REASON })
    expect(
      gateDecision({ agent: 'claude', toolName: 'Write', hasLoaded: false }),
    ).toEqual({ decision: 'deny', reason: GATE_DENY_REASON })
    expect(
      gateDecision({
        agent: 'codex',
        toolName: 'apply_patch',
        hasLoaded: false,
      }),
    ).toEqual({ decision: 'deny', reason: GATE_DENY_REASON })
    expect(
      gateDecision({ agent: 'copilot', toolName: 'Edit', hasLoaded: true }),
    ).toEqual({ decision: 'allow' })
    expect(
      gateDecision({ agent: 'codex', toolName: 'Bash', hasLoaded: false }),
    ).toEqual({ decision: 'allow' })
    expect(EDIT_TOOLS_BY_AGENT.copilot.has('Write')).toBe(true)
    expect(EDIT_TOOLS_BY_AGENT.claude.has('Edit')).toBe(true)
    expect(EDIT_TOOLS_BY_AGENT.codex.has('apply_patch')).toBe(true)
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

describe('intent hook agent adapters', () => {
  const deny = { decision: 'deny' as const, reason: GATE_DENY_REASON }

  it('formats Copilot PreToolUse denial output', () => {
    expect(formatCopilotPreToolUseOutput(deny)).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: GATE_DENY_REASON,
    })
    expect(formatCopilotPreToolUseOutput({ decision: 'allow' })).toBeUndefined()
  })

  it('formats Claude PreToolUse denial output', () => {
    expect(formatClaudePreToolUseOutput(deny)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: GATE_DENY_REASON,
      },
    })
    expect(formatClaudePreToolUseOutput({ decision: 'allow' })).toBeUndefined()
  })

  it('formats Codex PreToolUse denial output', () => {
    expect(formatCodexPreToolUseOutput(deny)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: GATE_DENY_REASON,
      },
    })
    expect(formatCodexPreToolUseOutput({ decision: 'allow' })).toBeUndefined()
  })
})
