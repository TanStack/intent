import { describe, expect, it } from 'vitest'
import {
  containsSecretLiteral,
  detectCapabilityHeuristics,
  findSecretMatches,
} from '../src/core/secrets.js'

describe('findSecretMatches / containsSecretLiteral', () => {
  it('finds no matches in ordinary skill content', () => {
    const content = '# My Skill\n\nUse `intent load` to fetch guidance.'
    expect(findSecretMatches(content)).toEqual([])
    expect(containsSecretLiteral(content)).toBe(false)
  })

  it('detects a GitHub token literal', () => {
    const content = 'export GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef'
    expect(containsSecretLiteral(content)).toBe(true)
    expect(findSecretMatches(content).map((m) => m.name)).toContain(
      'github-token',
    )
  })

  it('detects an AWS access key id literal', () => {
    const content = 'AKIAABCDEFGHIJKLMNOP'
    expect(containsSecretLiteral(content)).toBe(true)
  })

  it('detects a generic api-key assignment', () => {
    const content = 'const apiKey = "sk_live_abcdefghijklmnop1234"'
    expect(containsSecretLiteral(content)).toBe(true)
  })

  it('detects a PEM private key block', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIB...'
    expect(containsSecretLiteral(content)).toBe(true)
  })

  it('does not flag a secret NAME by itself (no value)', () => {
    const content = 'This skill requires the `GITHUB_TOKEN` environment variable.'
    expect(containsSecretLiteral(content)).toBe(false)
  })
})

describe('detectCapabilityHeuristics', () => {
  it('detects network usage from curl/wget/fetch', () => {
    expect(detectCapabilityHeuristics('run `curl https://example.com`').usesNetwork).toBe(
      true,
    )
    expect(detectCapabilityHeuristics('await fetch(url)').usesNetwork).toBe(true)
    expect(detectCapabilityHeuristics('no network here').usesNetwork).toBe(false)
  })

  it('detects install commands', () => {
    expect(detectCapabilityHeuristics('run `npm install foo`').runsInstallCommand).toBe(
      true,
    )
    expect(detectCapabilityHeuristics('run `pnpm add foo`').runsInstallCommand).toBe(
      true,
    )
    expect(detectCapabilityHeuristics('nothing here').runsInstallCommand).toBe(
      false,
    )
  })

  it('detects subprocess/child_process usage', () => {
    expect(detectCapabilityHeuristics('child_process.exec(cmd)').shellsOut).toBe(
      true,
    )
    expect(detectCapabilityHeuristics('spawn("ls")').shellsOut).toBe(true)
    expect(detectCapabilityHeuristics('nothing here').shellsOut).toBe(false)
  })
})
