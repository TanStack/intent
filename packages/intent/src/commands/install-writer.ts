import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  formatRuntimeSkillLookupComment,
  isRuntimeSkillLookupComment,
  isStableLoadPath,
} from '../skill-paths.js'
import type { ScanResult, SkillEntry } from '../types.js'

const INTENT_SKILLS_START = '<!-- intent-skills:start -->'
const INTENT_SKILLS_END = '<!-- intent-skills:end -->'

const SUPPORTED_AGENT_CONFIG_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]

const NON_ACTIONABLE_SKILL_TYPES = new Set([
  'maintainer',
  'maintainer-only',
  'meta',
  'reference',
])

export interface IntentSkillsBlockResult {
  block: string
  mappingCount: number
}

export interface WriteIntentSkillsBlockOptions extends IntentSkillsBlockResult {
  root: string
}

interface WriteIntentSkillsBlockFileResult {
  mappingCount: number
  status: 'created' | 'unchanged' | 'updated'
  targetPath: string
}

interface WriteIntentSkillsBlockSkippedResult {
  mappingCount: number
  status: 'skipped'
  targetPath: null
}

export type WriteIntentSkillsBlockResult =
  | WriteIntentSkillsBlockFileResult
  | WriteIntentSkillsBlockSkippedResult

interface ManagedBlock {
  end: number
  start: number
  text: string
}

interface IntentSkillsVerificationResult {
  errors: Array<string>
  ok: boolean
}

function normalizeBlock(content: string): string {
  return content.replace(/\r\n/g, '\n').trimEnd()
}

function readManagedBlock(content: string): {
  errors: Array<string>
  hasMarker: boolean
  managedBlock: ManagedBlock | null
} {
  const start = content.indexOf(INTENT_SKILLS_START)
  const errors: Array<string> = []
  if (start === -1) errors.push('Missing intent-skills start marker.')

  const endMarkerStart =
    start === -1
      ? content.indexOf(INTENT_SKILLS_END)
      : content.indexOf(INTENT_SKILLS_END, start)
  if (endMarkerStart === -1) errors.push('Missing intent-skills end marker.')

  const hasMarker = start !== -1 || endMarkerStart !== -1

  if (errors.length > 0 || start === -1 || endMarkerStart === -1) {
    return { errors, hasMarker, managedBlock: null }
  }

  const end = endMarkerStart + INTENT_SKILLS_END.length
  return {
    errors,
    hasMarker,
    managedBlock: {
      end,
      start,
      text: content.slice(start, end),
    },
  }
}

function parseSkillsList(block: string): {
  errors: Array<string>
  skills: Array<unknown>
} {
  const yamlBody = normalizeBlock(block)
    .split('\n')
    .filter(
      (line) => line !== INTENT_SKILLS_START && line !== INTENT_SKILLS_END,
    )
    .join('\n')

  try {
    const parsed = parseYaml(yamlBody) as { skills?: unknown } | null
    if (!parsed || !Array.isArray(parsed.skills)) {
      return {
        errors: ['Managed block must contain a skills list.'],
        skills: [],
      }
    }

    return { errors: [], skills: parsed.skills }
  } catch (err) {
    return {
      errors: [
        `Managed block contains invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      ],
      skills: [],
    }
  }
}

function validateRuntimeLookupEntries(
  block: string,
  skills: Array<unknown>,
): Array<string> {
  const skillEntryBlocks = readSkillEntryBlocks(block)
  for (let index = 0; index < skills.length; index++) {
    const skill = skills[index]
    if (!skill || typeof skill !== 'object') continue
    if (typeof (skill as { load?: unknown }).load === 'string') continue
    if (skillEntryBlocks[index]?.some(isRuntimeSkillLookupComment)) continue

    return ['Runtime lookup entries must include package and skill names.']
  }

  return []
}

function readSkillEntryBlocks(block: string): Array<Array<string>> {
  const entries: Array<Array<string>> = []
  let currentEntry: Array<string> | null = null

  for (const line of normalizeBlock(block).split('\n')) {
    if (line === INTENT_SKILLS_START || line === INTENT_SKILLS_END) {
      currentEntry = null
      continue
    }

    if (/^\s*-\s+/.test(line)) {
      currentEntry = [line]
      entries.push(currentEntry)
      continue
    }

    if (currentEntry && /^\s+/.test(line)) {
      currentEntry.push(line)
    }
  }

  return entries
}

export function verifyIntentSkillsBlockFile({
  expectedBlock,
  expectedMappingCount,
  targetPath,
}: {
  expectedBlock: string
  expectedMappingCount: number
  targetPath: string
}): IntentSkillsVerificationResult {
  const errors: Array<string> = []

  if (!existsSync(targetPath)) {
    return {
      errors: [`Agent config file was not created: ${targetPath}`],
      ok: false,
    }
  }

  const { managedBlock, errors: markerErrors } = readManagedBlock(
    readFileSync(targetPath, 'utf8'),
  )
  errors.push(...markerErrors)

  if (!managedBlock) {
    return { errors, ok: false }
  }

  const block = managedBlock.text
  if (normalizeBlock(block) !== normalizeBlock(expectedBlock)) {
    errors.push('Managed block does not match generated mappings.')
  }

  const { skills, errors: parseErrors } = parseSkillsList(block)
  errors.push(...parseErrors)
  if (skills.length !== expectedMappingCount) {
    errors.push(
      `Expected ${expectedMappingCount} skill mappings, found ${skills.length}.`,
    )
  }

  for (const skill of skills) {
    if (!skill || typeof skill !== 'object') {
      errors.push('Each skill mapping must be an object.')
      continue
    }

    const load = (skill as { load?: unknown }).load
    if (typeof load === 'string') {
      if (!isStableLoadPath(load)) {
        errors.push(`Unsafe load path in managed block: ${load}`)
      }
    }
  }

  errors.push(...validateRuntimeLookupEntries(block, skills))

  return {
    errors,
    ok: errors.length === 0,
  }
}

export function resolveIntentSkillsBlockTargetPath(
  root: string,
  mappingCount: number,
): string | null {
  if (mappingCount === 0) return null
  return (
    findExistingConfigWithManagedBlock(root)?.filePath ??
    join(root, 'AGENTS.md')
  )
}

function compareNames(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isTopLevelActionableSkill(skill: SkillEntry): boolean {
  if (skill.name.includes('/')) return false
  const type = skill.type?.trim().toLowerCase()
  return !type || !NON_ACTIONABLE_SKILL_TYPES.has(type)
}

function formatTask(packageName: string, skill: SkillEntry): string {
  const description = skill.description.replace(/\s+/g, ' ').trim()
  const prefix = `Use ${packageName} ${skill.name}`
  return description ? `${prefix}: ${description}` : prefix
}

export function buildIntentSkillsBlock(
  scanResult: ScanResult,
): IntentSkillsBlockResult {
  const lines = [
    INTENT_SKILLS_START,
    '# Skill mappings - when working in these areas, load the linked skill file into context.',
    'skills:',
  ]
  let mappingCount = 0

  for (const pkg of [...scanResult.packages].sort(compareNames)) {
    for (const skill of [...pkg.skills].sort(compareNames)) {
      if (!isTopLevelActionableSkill(skill)) continue

      mappingCount++
      lines.push(`  - task: ${quoteYamlString(formatTask(pkg.name, skill))}`)

      if (isStableLoadPath(skill.path)) {
        lines.push(`    load: ${quoteYamlString(skill.path)}`)
      } else {
        lines.push(
          `    # ${formatRuntimeSkillLookupComment({
            packageName: pkg.name,
            skillName: skill.name,
          })}`,
        )
      }
    }
  }

  if (mappingCount === 0) {
    lines[2] = 'skills: []'
  }

  lines.push(INTENT_SKILLS_END)
  return {
    block: `${lines.join('\n')}\n`,
    mappingCount,
  }
}

function detectNewline(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

function withNewlineStyle(content: string, newline: string): string {
  return newline === '\n' ? content : content.replace(/\n/g, newline)
}

function findExistingConfigWithManagedBlock(root: string): {
  content: string
  filePath: string
  managedBlock: ManagedBlock
} | null {
  for (const file of SUPPORTED_AGENT_CONFIG_FILES) {
    const filePath = join(root, file)
    if (!existsSync(filePath)) continue

    const content = readFileSync(filePath, 'utf8')
    const { managedBlock, errors, hasMarker } = readManagedBlock(content)
    if (managedBlock) return { content, filePath, managedBlock }
    if (hasMarker) {
      throw new Error(
        `Invalid intent-skills block in ${filePath}: ${errors.join(' ')}`,
      )
    }
  }

  return null
}

function replaceManagedBlock(
  content: string,
  managedBlock: ManagedBlock,
  block: string,
): string {
  const newline = detectNewline(content)
  const styledBlock = withNewlineStyle(block.trimEnd(), newline)
  return `${content.slice(0, managedBlock.start)}${styledBlock}${content.slice(managedBlock.end)}`
}

export function writeIntentSkillsBlock({
  block,
  mappingCount,
  root,
}: WriteIntentSkillsBlockOptions): WriteIntentSkillsBlockResult {
  if (mappingCount === 0) {
    return {
      mappingCount,
      status: 'skipped',
      targetPath: null,
    }
  }

  const existingTarget = findExistingConfigWithManagedBlock(root)
  const targetPath = existingTarget?.filePath ?? join(root, 'AGENTS.md')

  if (existingTarget) {
    const nextContent = replaceManagedBlock(
      existingTarget.content,
      existingTarget.managedBlock,
      block,
    )
    if (nextContent === existingTarget.content) {
      return {
        mappingCount,
        status: 'unchanged',
        targetPath,
      }
    }

    writeFileSync(targetPath, nextContent)
    return {
      mappingCount,
      status: 'updated',
      targetPath,
    }
  }

  if (existsSync(targetPath)) {
    const currentContent = readFileSync(targetPath, 'utf8')
    const newline = detectNewline(currentContent)
    const separator =
      currentContent.endsWith('\n') || currentContent === '' ? '' : newline
    const nextContent = `${currentContent}${separator}${withNewlineStyle(block, newline)}`

    writeFileSync(targetPath, nextContent)
    return {
      mappingCount,
      status: 'updated',
      targetPath,
    }
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, block)
  return {
    mappingCount,
    status: 'created',
    targetPath,
  }
}
