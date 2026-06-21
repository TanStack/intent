import type { SkillEntry } from '../shared/types.js'

export type SkillCategory = 'maintainer' | 'meta' | 'reference' | 'task'

const MAINTAINER_TYPES = new Set(['maintainer', 'maintainer-only'])

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
