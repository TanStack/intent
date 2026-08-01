import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DELIVERY_CONFIG_PATH,
  readIntentDeliveryConfig,
  writeIntentDeliveryConfig,
} from '../src/commands/install/delivery.js'
import type { IntentDeliveryConfig } from '../src/commands/install/delivery.js'

const roots: Array<string> = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('local delivery configuration', () => {
  it('round-trips the exact schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-delivery-'))
    roots.push(root)
    const config: IntentDeliveryConfig = {
      method: 'symlink',
      targets: ['agents', 'github'],
    }

    expect(DELIVERY_CONFIG_PATH).toBe('.intent/delivery.json')
    expect(writeIntentDeliveryConfig(root, config)).toBe(true)
    expect(readIntentDeliveryConfig(root)).toEqual(config)
    expect(
      JSON.parse(readFileSync(join(root, DELIVERY_CONFIG_PATH), 'utf8')),
    ).toEqual(config)
  })

  it.each([
    ['invalid JSON', '{'],
    ['unknown field', '{"method":"symlink","targets":["agents"],"extra":true}'],
    ['invalid method', '{"method":"copy","targets":["agents"]}'],
    ['empty targets', '{"method":"symlink","targets":[]}'],
    ['invalid target', '{"method":"symlink","targets":["unknown"]}'],
    ['duplicate target', '{"method":"symlink","targets":["agents","agents"]}'],
    ['unsupported target', '{"method":"hooks","targets":["vscode"]}'],
  ])('rejects %s', (_label, source) => {
    const root = mkdtempSync(join(tmpdir(), 'intent-delivery-'))
    roots.push(root)
    mkdirSync(join(root, '.intent'))
    writeFileSync(join(root, DELIVERY_CONFIG_PATH), source, 'utf8')

    expect(() => readIntentDeliveryConfig(root)).toThrow()
  })

  it('writes idempotently and excludes delivery from the local Git repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-delivery-'))
    roots.push(root)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    writeFileSync(join(root, '.gitignore'), 'shared\r\n', 'utf8')
    const config: IntentDeliveryConfig = {
      method: 'hooks',
      targets: ['github'],
    }

    expect(writeIntentDeliveryConfig(root, config)).toBe(true)
    expect(writeIntentDeliveryConfig(root, config)).toBe(false)
    expect(readIntentDeliveryConfig(root)).toEqual(config)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'shared\r\n.intent/\r\n',
    )
    expect(
      readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8'),
    ).not.toContain(DELIVERY_CONFIG_PATH)
  })
})
