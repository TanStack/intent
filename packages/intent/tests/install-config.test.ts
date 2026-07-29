import { describe, expect, it } from 'vitest'
import {
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from '../src/commands/install/config.js'
import type { IntentConsumerConfig } from '../src/commands/install/config.js'

describe('installer configuration', () => {
  it('updates JSONC fields without changing unrelated formatting', () => {
    const source =
      '\ufeff{\r\n\t// keep this comment\r\n\t"name": "app",\r\n\t"intent": {\r\n\t\t"skills": ["old"],\r\n\t},\r\n}\r\n'
    const updated = updateIntentConsumerConfigText(source, {
      skills: ['@tanstack/query'],
      exclude: ['@other/pkg'],
    })

    expect(updated.startsWith('\ufeff')).toBe(true)
    expect(updated).toContain('\t// keep this comment\r\n')
    expect(updated).toContain('\t"name": "app"')
    expect(updated).toContain('\r\n')
    expect(updated.endsWith('\r\n')).toBe(true)
    expect(readIntentConsumerConfig(updated)).toEqual({
      skills: ['@tanstack/query'],
      exclude: ['@other/pkg'],
    })
  })

  it('returns byte-identical JSONC for an unchanged request', () => {
    const source =
      '{\n  // formatting stays\n  "intent": {\n    "skills": ["pkg"],\n    "exclude": []\n  }\n}\n'
    const requested: IntentConsumerConfig = { skills: ['pkg'], exclude: [] }
    expect(updateIntentConsumerConfigText(source, requested)).toBe(source)
  })

  it('ignores legacy intent.install when reading policy', () => {
    expect(
      readIntentConsumerConfig(
        '{"intent":{"skills":["pkg"],"exclude":[],"install":"invalid"}}',
      ),
    ).toEqual({ skills: ['pkg'], exclude: [] })
  })

  it('removes legacy intent.install when updating policy', () => {
    const updated = updateIntentConsumerConfigText(
      '{"intent":{"skills":["old"],"exclude":[],"install":{"method":"hooks"}}}\n',
      { skills: ['pkg'], exclude: [] },
    )

    expect(updated).not.toContain('"install"')
    expect(readIntentConsumerConfig(updated)).toEqual({
      skills: ['pkg'],
      exclude: [],
    })
  })

  it('preserves unchanged array formatting when another field changes', () => {
    const source = `{
  "intent": {
    "skills": [
      "first",
      "second"
    ],
    "exclude": []
  }
}
`

    const updated = updateIntentConsumerConfigText(source, {
      skills: ['first', 'second'],
      exclude: ['ignored'],
    })

    expect(updated).toContain(
      '"skills": [\n      "first",\n      "second"\n    ]',
    )
  })

  it('rejects blank exclude entries', () => {
    expect(() =>
      readIntentConsumerConfig('{"intent":{"exclude":["  "]}}'),
    ).toThrow('must not contain blank entries')
  })
})
