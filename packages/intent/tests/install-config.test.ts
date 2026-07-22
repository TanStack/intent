import { describe, expect, it } from 'vitest'
import {
  INSTALL_TARGETS,
  installTargetsForMethod,
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from '../src/commands/install/config.js'
import type {
  InstallMethod,
  IntentConsumerConfig,
  IntentInstallPreferences,
} from '../src/commands/install/config.js'

describe('installer configuration', () => {
  it('provides neutral install targets without detected or selected state', () => {
    expect(INSTALL_TARGETS).toEqual([
      { id: 'agents', label: 'Shared .agents directory' },
      { id: 'github', label: 'GitHub Copilot' },
      { id: 'vscode', label: 'VS Code' },
      { id: 'cursor', label: 'Cursor' },
      { id: 'codex', label: 'Codex' },
      { id: 'claude', label: 'Claude Code' },
    ])
  })

  it('filters targets by the selected delivery method', () => {
    expect(
      installTargetsForMethod('symlink').map((target) => target.id),
    ).toEqual(['agents', 'github', 'vscode', 'cursor', 'codex', 'claude'])
    expect(installTargetsForMethod('hooks').map((target) => target.id)).toEqual(
      ['github', 'codex', 'claude'],
    )
    expect(installTargetsForMethod('map').map((target) => target.id)).toEqual([
      'agents',
      'github',
      'vscode',
      'cursor',
      'codex',
      'claude',
    ])
  })

  it('rejects an install method unsupported by a selected target', () => {
    const preferences: IntentInstallPreferences = {
      method: 'map',
      targets: ['github'],
    }
    const method: InstallMethod = preferences.method
    expect(method).toBe('map')
    expect(() =>
      readIntentConsumerConfig(
        '{ "intent": { "install": { "method": "hooks", "targets": ["vscode"] } } }',
      ),
    ).toThrow('not supported')
  })

  it('rejects duplicate install targets', () => {
    expect(() =>
      readIntentConsumerConfig(
        '{ "intent": { "install": { "method": "map", "targets": ["agents", "agents"] } } }',
      ),
    ).toThrow('Duplicate')
  })

  it('rejects unknown install fields', () => {
    expect(() =>
      readIntentConsumerConfig(
        '{ "intent": { "install": { "method": "map", "targets": [], "extra": true } } }',
      ),
    ).toThrow('Unknown')
  })

  it('rejects unknown targets, methods, and wrong target types', () => {
    expect(() =>
      readIntentConsumerConfig(
        '{ "intent": { "install": { "method": "map", "targets": ["unknown"] } } }',
      ),
    ).toThrow('Unknown install target')
    expect(() =>
      readIntentConsumerConfig(
        '{ "intent": { "install": { "method": "unknown", "targets": ["github"] } } }',
      ),
    ).toThrow('Unknown install method')
    expect(() =>
      readIntentConsumerConfig(
        '{ "intent": { "install": { "method": "map", "targets": "github" } } }',
      ),
    ).toThrow('array of strings')
  })

  it('updates JSONC fields without changing unrelated formatting', () => {
    const source =
      '\ufeff{\r\n\t// keep this comment\r\n\t"name": "app",\r\n\t"intent": {\r\n\t\t"skills": ["old"],\r\n\t},\r\n}\r\n'
    const updated = updateIntentConsumerConfigText(source, {
      skills: ['@tanstack/query'],
      exclude: ['@other/pkg'],
      install: { method: 'map', targets: ['github'] },
    })

    expect(updated.startsWith('\ufeff')).toBe(true)
    expect(updated).toContain('\t// keep this comment\r\n')
    expect(updated).toContain('\t"name": "app"')
    expect(updated).toContain('\r\n')
    expect(updated.endsWith('\r\n')).toBe(true)
    expect(readIntentConsumerConfig(updated)).toEqual({
      skills: ['@tanstack/query'],
      exclude: ['@other/pkg'],
      install: { method: 'map', targets: ['github'] },
    })
  })

  it('returns byte-identical JSONC for an unchanged request', () => {
    const source =
      '{\n  // formatting stays\n  "intent": {\n    "skills": ["pkg"],\n    "exclude": []\n  }\n}\n'
    const requested: IntentConsumerConfig = { skills: ['pkg'], exclude: [] }
    expect(updateIntentConsumerConfigText(source, requested)).toBe(source)
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
