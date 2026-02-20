import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export type SkillEntry = {
  name: string
  package: string | null
  internal: boolean
  description: string
  source?: string
}

type Registry = {
  skills: SkillEntry[]
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(moduleDir, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const skillsRoot = path.join(repoRoot, 'skills')
const registryPath = path.join(skillsRoot, 'registry.json')
const require = createRequire(import.meta.url)

export function getSkills(): SkillEntry[] {
  const raw = fs.readFileSync(registryPath, 'utf8')
  const data = JSON.parse(raw) as Registry
  return data.skills
}

export function getSkill(name: string): SkillEntry | undefined {
  return getSkills().find((skill) => skill.name === name)
}

export function getSkillPath(name: string): string {
  const skill = getSkill(name)
  if (skill?.source) {
    return resolveSourcePath(skill.source)
  }

  const parts = name.split('/')
  if (parts.length < 2) {
    throw new Error(`Invalid skill name: ${name}`)
  }

  const library = parts[0]
  const skillPath = parts.slice(1).join('/')

  return path.join(skillsRoot, library, skillPath, 'SKILL.md')
}

function resolveSourcePath(source: string): string {
  const [pkg, ...rest] = source.split(':')
  if (!pkg || rest.length === 0) {
    throw new Error(`Invalid skill source: ${source}`)
  }

  const relativePath = rest.join(':')
  const packageJsonPath = require.resolve(`${pkg}/package.json`)
  const packageRoot = path.dirname(packageJsonPath)

  return path.join(packageRoot, relativePath)
}
