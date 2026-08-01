import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { writeTextFileAtomic } from '../../shared/atomic-write.js'
import { writeIntentGitignore } from '../sync/gitignore.js'

export const DELIVERY_CONFIG_PATH = '.intent/delivery.json'

export type DeliveryMethod = 'symlink' | 'hooks'
export type InstallMethod = DeliveryMethod | 'map'
export type InstallTarget =
  | 'agents'
  | 'github'
  | 'vscode'
  | 'cursor'
  | 'codex'
  | 'claude'

export interface IntentDeliveryConfig {
  method: DeliveryMethod
  targets: Array<InstallTarget>
}

export const INSTALL_TARGETS: ReadonlyArray<{
  id: InstallTarget
  label: string
}> = [
  { id: 'agents', label: 'Shared .agents directory' },
  { id: 'github', label: 'GitHub Copilot' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude Code' },
]

const INSTALL_METHODS: Readonly<
  Record<DeliveryMethod, ReadonlySet<InstallTarget>>
> = {
  symlink: new Set(INSTALL_TARGETS.map((target) => target.id)),
  hooks: new Set(['github', 'codex', 'claude']),
}

export function installTargetsForMethod(
  method: DeliveryMethod,
): typeof INSTALL_TARGETS {
  return INSTALL_TARGETS.filter((target) =>
    INSTALL_METHODS[method].has(target.id),
  )
}

function isDirectory(root: string, path: string): boolean {
  const target = join(root, path)
  return existsSync(target) && statSync(target).isDirectory()
}

export function detectInstallTargets(root: string): Array<InstallTarget> {
  return INSTALL_TARGETS.flatMap((target) => {
    switch (target.id) {
      case 'agents':
        return isDirectory(root, '.agents') ||
          existsSync(join(root, 'AGENTS.md'))
          ? [target.id]
          : []
      case 'github':
        return existsSync(join(root, '.github/copilot-instructions.md'))
          ? [target.id]
          : []
      case 'vscode':
        return isDirectory(root, '.vscode') ? [target.id] : []
      case 'cursor':
        return isDirectory(root, '.cursor') ||
          existsSync(join(root, '.cursorrules'))
          ? [target.id]
          : []
      case 'codex':
        return isDirectory(root, '.codex') ? [target.id] : []
      case 'claude':
        return isDirectory(root, '.claude') ||
          existsSync(join(root, 'CLAUDE.md'))
          ? [target.id]
          : []
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateIntentDeliveryConfig(value: unknown): IntentDeliveryConfig {
  if (!isRecord(value)) throw new Error('Local delivery must be an object.')
  if (Object.keys(value).sort().join(',') !== 'method,targets') {
    throw new Error('Local delivery must contain exactly method and targets.')
  }
  if (typeof value.method !== 'string' || !(value.method in INSTALL_METHODS)) {
    throw new Error(`Unknown install method "${String(value.method)}".`)
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new Error('Local delivery targets must be a non-empty array.')
  }
  const method = value.method as DeliveryMethod
  const targets: Array<InstallTarget> = []
  const seen = new Set<string>()
  for (const target of value.targets) {
    if (
      typeof target !== 'string' ||
      !INSTALL_TARGETS.some((candidate) => candidate.id === target)
    ) {
      throw new Error(`Unknown install target "${String(target)}".`)
    }
    if (seen.has(target)) {
      throw new Error(`Duplicate install target "${target}".`)
    }
    if (!INSTALL_METHODS[method].has(target as InstallTarget)) {
      throw new Error(
        `Install method "${method}" is not supported for "${target}".`,
      )
    }
    seen.add(target)
    targets.push(target as InstallTarget)
  }
  return { method, targets }
}

function parseIntentDeliveryConfig(text: string): IntentDeliveryConfig {
  try {
    return validateIntentDeliveryConfig(JSON.parse(text))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid local delivery JSON: ${error.message}`)
    }
    throw error
  }
}

function serializeIntentDeliveryConfig(config: IntentDeliveryConfig): string {
  return `${JSON.stringify(validateIntentDeliveryConfig(config), null, 2)}\n`
}

export function readIntentDeliveryConfig(
  root: string,
): IntentDeliveryConfig | null {
  const path = join(root, DELIVERY_CONFIG_PATH)
  if (!existsSync(path)) return null
  try {
    return parseIntentDeliveryConfig(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(
      `Invalid local delivery at ${DELIVERY_CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export function writeIntentDeliveryConfig(
  root: string,
  config: IntentDeliveryConfig,
): boolean {
  const path = join(root, DELIVERY_CONFIG_PATH)
  const content = serializeIntentDeliveryConfig(config)
  writeIntentGitignore(root)
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  writeTextFileAtomic(path, content)
  return true
}
