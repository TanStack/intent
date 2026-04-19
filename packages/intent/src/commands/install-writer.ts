import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { formatSkillUse, parseSkillUse } from '../skill-use.js'
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

    const mapping = skill as { load?: unknown; use?: unknown; when?: unknown }

    if (mapping.load !== undefined) {
      errors.push('Skill mappings must use compact `use` entries, not `load`.')
    }

    if (typeof mapping.when !== 'string' || mapping.when.trim() === '') {
      errors.push('Each skill mapping must include a non-empty `when` field.')
    }

    if (typeof mapping.use !== 'string') {
      errors.push('Each skill mapping must include a `use` field.')
    } else {
      try {
        parseSkillUse(mapping.use)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
  }

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
  return a.name.localeCompare(b.name)
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

function isActionableSkill(skill: SkillEntry): boolean {
  const type = skill.type?.trim().toLowerCase()
  return !type || !NON_ACTIONABLE_SKILL_TYPES.has(type)
}

function formatWhen(packageName: string, skill: SkillEntry): string {
  const description = skill.description.replace(/\s+/g, ' ').trim()
  return description || `Use ${packageName} ${skill.name}`
}

export function buildIntentSkillsBlock(
  scanResult: ScanResult,
): IntentSkillsBlockResult {
  const lines = [
    INTENT_SKILLS_START,
    '# Skill mappings - resolve `use` with `npx @tanstack/intent@latest resolve <use>`.',
    'skills:',
  ]
  let mappingCount = 0

  for (const pkg of [...scanResult.packages].sort(compareNames)) {
    for (const skill of [...pkg.skills].sort(compareNames)) {
      if (!isActionableSkill(skill)) continue

      mappingCount++
      lines.push(`  - when: ${quoteYamlString(formatWhen(pkg.name, skill))}`)
      lines.push(
        `    use: ${quoteYamlString(formatSkillUse(pkg.name, skill.name))}`,
      )
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
