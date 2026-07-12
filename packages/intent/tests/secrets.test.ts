import { describe, expect, it } from 'vitest'
import { findSecretMatches } from '../src/core/secrets.js'

describe('findSecretMatches', () => {
  it.each([
    ['github-token', `ghp_${'a'.repeat(20)}`],
    ['aws-access-key-id', `AKIA${'A'.repeat(16)}`],
    ['generic-api-key-assignment', `api_key = "${'a'.repeat(16)}"`],
    ['private-key-block', '-----BEGIN PRIVATE KEY-----'],
    ['slack-token', 'xoxb-1234567890-abcdef'],
  ])('detects %s without returning the value', (name, content) => {
    expect(findSecretMatches(content)).toEqual([{ name, index: 0 }])
    expect(JSON.stringify(findSecretMatches(content))).not.toContain(content)
  })

  it('does not flag declared secret names', () => {
    expect(findSecretMatches('declaredSecrets: [GITHUB_TOKEN]')).toEqual([])
  })
})
