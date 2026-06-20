import type { ExpectedSkillArea } from './tasks'

export const expectedSkillUseByArea = {
  router: '@tanstack/router#routing',
  start: '@tanstack/start#routing',
  'table-v9': '@tanstack/table#v9-columns',
} satisfies Record<ExpectedSkillArea, string>

export const packageAllowlistByArea = {
  router: '@tanstack/router',
  start: '@tanstack/start',
  'table-v9': '@tanstack/table',
} satisfies Record<ExpectedSkillArea, string>
