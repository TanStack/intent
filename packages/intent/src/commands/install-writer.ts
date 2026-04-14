import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  formatRuntimeSkillLookupComment,
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

const RUNTIME_LOOKUP_COMMENT =
  /# Runtime lookup only: run `npx @tanstack\/intent@latest list --json`, find package "[^"]+" skill "[^"]+", and load its reported path for this session\. Do not copy the resolved path into this file\./

export interface IntentSkillsBlockResult {
  block: string
  mappingCount: number
}

type IntentSkillsWriteStatus =
  | 'created'
  | 'skipped'
  | 'unchanged'
  | 'updated'

export interface WriteIntentSkillsBlockOptions extends IntentSkillsBlockResult {
  root: string
}

export interface WriteIntentSkillsBlockResult {
  mappingCount: number
  status: IntentSkillsWriteStatus
  targetPath: string | null
}

function normalizeBlock(content: string): string {
  return content.replace(/\r\n/g, '\n').trimEnd()
}

function extractManagedBlock(content: string): {
  block: string | null
  errors: Array<string>
} {
  const start = content.indexOf(INTENT_SKILLS_START)
  const errors: Array<string> = []
  if (start === -1) errors.push('Missing intent-skills start marker.')

  const endMarkerStart =
    start === -1 ? -1 : content.indexOf(INTENT_SKILLS_END, start)
  if (endMarkerStart === -1) errors.push('Missing intent-skills end marker.')

  if (errors.length > 0 || start === -1 || endMarkerStart === -1) {
    return { block: null, errors }
  }

  return {
    block: content.slice(start, endMarkerStart + INTENT_SKILLS_END.length),
    errors,
  }
}

function parseSkillsList(block: string, errors: Array<string>): Array<unknown> {
  const yamlBody = normalizeBlock(block)
    .split('\n')
    .filter(
      (line) => line !== INTENT_SKILLS_START && line !== INTENT_SKILLS_END,
    )
    .join('\n')

  try {
    const parsed = parseYaml(yamlBody) as { skills?: unknown } | null
    if (!parsed || !Array.isArray(parsed.skills)) {
      errors.push('Managed block must contain a skills list.')
      return []
    }

    return parsed.skills
  } catch (err) {
    errors.push(
      `Managed block contains invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

function validateRuntimeLookupEntries(
  block: string,
  missingLoadCount: number,
  errors: Array<string>,
): void {
  if (missingLoadCount === 0) return

  const validRuntimeLookupCount = normalizeBlock(block)
    .split('\n')
    .filter((line) => line.includes('Runtime lookup only:'))
    .filter((line) => RUNTIME_LOOKUP_COMMENT.test(line)).length

  if (validRuntimeLookupCount < missingLoadCount) {
    errors.push('Runtime lookup entries must include package and skill names.')
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
}) {
  const errors: Array<string> = []

  if (!existsSync(targetPath)) {
    return {
      errors: [`Agent config file was not created: ${targetPath}`],
      ok: false,
    }
  }

  const { block, errors: markerErrors } = extractManagedBlock(
    readFileSync(targetPath, 'utf8'),
  )
  errors.push(...markerErrors)

  if (!block) {
    return { errors, ok: false }
  }

  if (normalizeBlock(block) !== normalizeBlock(expectedBlock)) {
    errors.push('Managed block does not match generated mappings.')
  }

  const skills = parseSkillsList(block, errors)
  if (skills.length !== expectedMappingCount) {
    errors.push(
      `Expected ${expectedMappingCount} skill mappings, found ${skills.length}.`,
    )
  }

  let missingLoadCount = 0
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
    } else {
      missingLoadCount++
    }
  }

  validateRuntimeLookupEntries(block, missingLoadCount, errors)

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
    findExistingConfigWithManagedBlock(root)?.filePath ?? join(root, 'AGENTS.md')
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

function findManagedBlock(
  content: string,
): { end: number; start: number } | null {
  const start = content.indexOf(INTENT_SKILLS_START)
  if (start === -1) return null

  const endMarkerStart = content.indexOf(INTENT_SKILLS_END, start)
  if (endMarkerStart === -1) return null

  return {
    start,
    end: endMarkerStart + INTENT_SKILLS_END.length,
  }
}

function findExistingConfigWithManagedBlock(
  root: string,
): {
  content: string
  filePath: string
  managedBlock: { end: number; start: number }
} | null {
  for (const file of SUPPORTED_AGENT_CONFIG_FILES) {
    const filePath = join(root, file)
    if (!existsSync(filePath)) continue

    const content = readFileSync(filePath, 'utf8')
    const managedBlock = findManagedBlock(content)
    if (managedBlock) return { content, filePath, managedBlock }
  }

  return null
}

function replaceManagedBlock(
  content: string,
  managedBlock: { end: number; start: number },
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
