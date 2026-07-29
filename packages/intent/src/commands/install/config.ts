import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { compileExcludePatterns } from '../../core/excludes.js'
import { parseSkillSources } from '../../core/skill-sources.js'

export type InstallMethod = 'symlink' | 'hooks'
export type InstallTarget =
  | 'agents'
  | 'github'
  | 'vscode'
  | 'cursor'
  | 'codex'
  | 'claude'

export interface IntentInstallPreferences {
  targets: Array<InstallTarget>
  method: InstallMethod
}

export interface IntentConsumerConfig {
  skills: Array<string>
  exclude: Array<string>
  install?: IntentInstallPreferences
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
  Record<InstallMethod, ReadonlySet<InstallTarget>>
> = {
  symlink: new Set(INSTALL_TARGETS.map((target) => target.id)),
  hooks: new Set(['github', 'codex', 'claude']),
}

export function installTargetsForMethod(
  method: InstallMethod,
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

function requireStringArray(value: unknown, label: string): Array<string> {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(`${label} must be an array of strings.`)
  }
  return value
}

function validateExcludes(excludes: Array<string>): void {
  if (excludes.some((entry) => entry.trim() === '')) {
    throw new Error('intent.exclude must not contain blank entries.')
  }
  compileExcludePatterns(excludes)
}

function validateInstall(value: unknown): IntentInstallPreferences {
  if (!isRecord(value)) throw new Error('intent.install must be an object.')
  for (const key of Object.keys(value)) {
    if (key !== 'targets' && key !== 'method') {
      throw new Error(`Unknown intent.install field "${key}".`)
    }
  }
  const targets = requireStringArray(value.targets, 'intent.install.targets')
  if (targets.length === 0) {
    throw new Error('intent.install.targets must not be empty.')
  }
  const seen = new Set<string>()
  for (const target of targets) {
    if (!INSTALL_TARGETS.some((candidate) => candidate.id === target)) {
      throw new Error(`Unknown install target "${target}".`)
    }
    if (seen.has(target))
      throw new Error(`Duplicate install target "${target}".`)
    seen.add(target)
  }
  if (typeof value.method !== 'string' || !(value.method in INSTALL_METHODS)) {
    throw new Error(`Unknown install method "${String(value.method)}".`)
  }
  const method = value.method as InstallMethod
  for (const target of targets) {
    if (!INSTALL_METHODS[method].has(target as InstallTarget)) {
      throw new Error(
        `Install method "${method}" is not supported for "${target}".`,
      )
    }
  }
  return { targets: targets as Array<InstallTarget>, method }
}

function parsePackageJson(text: string): Record<string, unknown> {
  const errors: Array<{ error: number; offset: number; length: number }> = []
  const value = parse(text.replace(/^\ufeff/, ''), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0 || !isRecord(value)) {
    throw new Error('Invalid package.json JSONC.')
  }
  return value
}

export function hasIntentDevDependency(text: string): boolean {
  const devDependencies = parsePackageJson(text).devDependencies
  return (
    isRecord(devDependencies) &&
    typeof devDependencies['@tanstack/intent'] === 'string'
  )
}

export function hasExplicitIntentSkills(text: string): boolean {
  const intent = parsePackageJson(text).intent
  return isRecord(intent) && Object.hasOwn(intent, 'skills')
}

export function readIntentConsumerConfig(text: string): IntentConsumerConfig {
  const packageJson = parsePackageJson(text)
  const intent = packageJson.intent
  if (intent === undefined) return { skills: [], exclude: [] }
  if (!isRecord(intent)) throw new Error('intent must be an object.')
  const skills =
    intent.skills === undefined
      ? []
      : requireStringArray(intent.skills, 'intent.skills')
  const exclude =
    intent.exclude === undefined
      ? []
      : requireStringArray(intent.exclude, 'intent.exclude')
  parseSkillSources(skills)
  validateExcludes(exclude)
  return {
    skills,
    exclude,
    ...(intent.install === undefined
      ? {}
      : { install: validateInstall(intent.install) }),
  }
}

function equalsConfig(
  left: IntentConsumerConfig,
  right: IntentConsumerConfig,
): boolean {
  return (
    equalsArray(left.skills, right.skills) &&
    equalsArray(left.exclude, right.exclude) &&
    equalsInstall(left.install, right.install)
  )
}

function equalsArray(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  )
}

function equalsInstall(
  left: IntentInstallPreferences | undefined,
  right: IntentInstallPreferences | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return (
    left.method === right.method && equalsArray(left.targets, right.targets)
  )
}

function formattingOptions(text: string): {
  eol: string
  insertSpaces: boolean
  tabSize: number
} {
  const indentation = /\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  return {
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  }
}

function applyModification(
  text: string,
  path: Array<string>,
  value: unknown,
  options: ReturnType<typeof formattingOptions>,
): string {
  return applyEdits(
    text,
    modify(text, path, value, { formattingOptions: options }),
  )
}

export function updateIntentConsumerConfigText(
  text: string,
  requested: IntentConsumerConfig,
): string {
  const existing = readIntentConsumerConfig(text)
  const normalized = {
    skills: requireStringArray(requested.skills, 'intent.skills'),
    exclude: requireStringArray(requested.exclude, 'intent.exclude'),
    ...(requested.install === undefined
      ? {}
      : { install: validateInstall(requested.install) }),
  }
  parseSkillSources(normalized.skills)
  validateExcludes(normalized.exclude)
  if (equalsConfig(existing, normalized)) return text

  const bom = text.startsWith('\ufeff') ? '\ufeff' : ''
  const options = formattingOptions(text)
  let updated = bom === '' ? text : text.slice(1)
  if (!equalsArray(existing.skills, normalized.skills)) {
    updated = applyModification(
      updated,
      ['intent', 'skills'],
      normalized.skills,
      options,
    )
  }
  if (!equalsArray(existing.exclude, normalized.exclude)) {
    updated = applyModification(
      updated,
      ['intent', 'exclude'],
      normalized.exclude,
      options,
    )
  }
  if (!equalsInstall(existing.install, normalized.install)) {
    updated = applyModification(
      updated,
      ['intent', 'install'],
      normalized.install,
      options,
    )
  }
  return `${bom}${updated}`
}
