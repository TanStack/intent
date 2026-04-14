// ---------------------------------------------------------------------------
// Shared display helpers for CLI output
// ---------------------------------------------------------------------------

import {
  formatRuntimeSkillLookupHint,
  isStableLoadPath,
} from './skill-paths.js'

export interface SkillDisplay {
  name: string
  description: string
  type?: string
  path?: string
}

function padColumn(text: string, width: number): string {
  return text.length >= width ? text + '  ' : text.padEnd(width)
}

export function printTable(
  headers: Array<string>,
  rows: Array<Array<string>>,
): void {
  const widths = headers.map(
    (h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 2,
  )

  const headerLine = headers.map((h, i) => padColumn(h, widths[i]!)).join('')
  const separator = widths.map((w) => '─'.repeat(w)).join('')

  console.log(headerLine)
  console.log(separator)
  for (const row of rows) {
    console.log(row.map((cell, i) => padColumn(cell, widths[i]!)).join(''))
  }
}

function printSkillLine(
  displayName: string,
  skill: SkillDisplay,
  indent: number,
  opts: { nameWidth: number; showTypes: boolean; packageName?: string },
): void {
  const nameStr = ' '.repeat(indent) + displayName
  const padding = ' '.repeat(Math.max(2, opts.nameWidth - nameStr.length))
  const typeCol = opts.showTypes
    ? (skill.type ? `[${skill.type}]` : '').padEnd(14)
    : ''
  console.log(`${nameStr}${padding}${typeCol}${skill.description}`)
  if (skill.path) {
    const pathIndent = ' '.repeat(indent + 2)
    if (isStableLoadPath(skill.path)) {
      console.log(`${pathIndent}${skill.path}`)
    } else {
      console.log(
        `${pathIndent}${formatRuntimeSkillLookupHint({
          packageName: opts.packageName,
          skillName: skill.name,
        })}`,
      )
    }
  }
}

export function printSkillTree(
  skills: Array<SkillDisplay>,
  opts: { nameWidth: number; showTypes: boolean; packageName?: string },
): void {
  const roots: Array<string> = []
  const children = new Map<string, Array<SkillDisplay>>()

  for (const skill of skills) {
    const slashIdx = skill.name.indexOf('/')
    if (slashIdx === -1) {
      roots.push(skill.name)
    } else {
      const parent = skill.name.slice(0, slashIdx)
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent)!.push(skill)
    }
  }

  if (roots.length === 0) {
    for (const skill of skills) {
      if (!roots.includes(skill.name)) roots.push(skill.name)
    }
  }

  for (const rootName of roots) {
    const rootSkill = skills.find((s) => s.name === rootName)
    if (!rootSkill) continue

    printSkillLine(rootName, rootSkill, 4, opts)

    for (const sub of children.get(rootName) ?? []) {
      const childName = sub.name.slice(sub.name.indexOf('/') + 1)
      printSkillLine(childName, sub, 6, opts)
    }
  }
}

export function computeSkillNameWidth(
  allPackageSkills: Array<Array<SkillDisplay>>,
): number {
  let max = 0
  for (const skills of allPackageSkills) {
    for (const s of skills) {
      const slashIdx = s.name.indexOf('/')
      const displayName = slashIdx === -1 ? s.name : s.name.slice(slashIdx + 1)
      const indent = slashIdx === -1 ? 4 : 6
      max = Math.max(max, indent + displayName.length)
    }
  }
  return max + 2
}
