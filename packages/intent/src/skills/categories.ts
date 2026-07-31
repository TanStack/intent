import type { SkillEntry } from '../shared/types.js'

export type SkillCategory = 'maintainer' | 'meta' | 'reference' | 'task'

const MAINTAINER_TYPES = new Set(['maintainer', 'maintainer-only'])
// core..security are what the authoring meta-skills emit; getSkillCategory maps them to 'task'.
const KNOWN_SKILL_TYPES = new Set([
  'task',
  'reference',
  'meta',
  'core',
  'sub-skill',
  'framework',
  'lifecycle',
  'composition',
  'security',
  ...MAINTAINER_TYPES,
])

export function isKnownSkillType(type: string): boolean {
  return KNOWN_SKILL_TYPES.has(type.trim().toLowerCase())
}

export function getSkillCategory(
  skill: Pick<SkillEntry, 'type'>,
): SkillCategory {
  const type = skill.type?.trim().toLowerCase()

  if (type === 'reference') return 'reference'
  if (type === 'meta') return 'meta'
  if (type && MAINTAINER_TYPES.has(type)) return 'maintainer'

  return 'task'
}

export function isGeneratedMappingSkill(
  skill: Pick<SkillEntry, 'type'>,
): boolean {
  return getSkillCategory(skill) === 'task'
}
