import {
  formatRuntimeSkillLookupComment,
  isStableLoadPath,
} from '../skill-paths.js'
import type { ScanResult, SkillEntry } from '../types.js'

export const INTENT_SKILLS_START = '<!-- intent-skills:start -->'
export const INTENT_SKILLS_END = '<!-- intent-skills:end -->'

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
