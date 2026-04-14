import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  formatRuntimeSkillLookupComment,
  isStableLoadPath,
} from '../skill-paths.js'
import type { ScanResult, SkillEntry } from '../types.js'

export const INTENT_SKILLS_START = '<!-- intent-skills:start -->'
export const INTENT_SKILLS_END = '<!-- intent-skills:end -->'

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

export type IntentSkillsWriteStatus =
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
