import type { IntentDiscoveryCondition } from './conditions'
import type { ExpectedSkillArea, IntentDiscoveryFixture } from './tasks'

export type LiveSessionProfile = {
  id: string
  model: string
  effort: 'default' | 'low' | 'medium' | 'high'
}

export type LiveSessionTurn = {
  id: string
  kind: 'related' | 'unrelated'
  prompt: string
  expectedSkillArea?: ExpectedSkillArea
  validation:
    | 'format-display-name'
    | 'format-table-heading'
    | 'router'
    | 'sort-user-ids'
    | 'start'
    | 'table-v9'
}

export type LiveSessionCase = {
  id: string
  condition: Extract<
    IntentDiscoveryCondition,
    'hooked-intent' | 'mapped-intent' | 'no-intent' | 'symlink-intent'
  >
  fixture: IntentDiscoveryFixture
  profile: LiveSessionProfile
  turns: ReadonlyArray<LiveSessionTurn>
}

export const liveSessionProfiles: ReadonlyArray<LiveSessionProfile> = [
  { id: 'haiku-default', model: 'claude-haiku-4.5', effort: 'default' },
  { id: 'sonnet-medium', model: 'claude-sonnet-4.6', effort: 'medium' },
  { id: 'opus-high', model: 'claude-opus-4.8', effort: 'high' },
  { id: 'gpt-mini-low', model: 'gpt-5.4-mini', effort: 'low' },
  { id: 'gpt-sol-high', model: 'gpt-5.6-sol', effort: 'high' },
]

export const liveSessionTurns: ReadonlyArray<LiveSessionTurn> = [
  {
    id: 'unrelated-format',
    kind: 'unrelated',
    prompt:
      'Update src/lib/format-display-name.ts so formatDisplayName trims both names, omits empty parts, and joins remaining parts with one space.',
    validation: 'format-display-name',
  },
  {
    id: 'router-loader',
    kind: 'related',
    prompt:
      'Update src/routes/users.$userId.tsx so the route loads /api/users/:userId before rendering, throws "Unable to load user" for non-OK responses, and renders the loaded user name.',
    expectedSkillArea: 'router',
    validation: 'router',
  },
  {
    id: 'table-heading',
    kind: 'unrelated',
    prompt:
      'Update src/format-table-heading.ts so formatTableHeading converts repeated hyphens and surrounding whitespace into a title-cased heading.',
    validation: 'format-table-heading',
  },
  {
    id: 'start-server-function',
    kind: 'related',
    prompt:
      'Update src/routes/users.tsx so user data is loaded through a GET TanStack Start server function and the route loader instead of module-level static data.',
    expectedSkillArea: 'start',
    validation: 'start',
  },
  {
    id: 'table-sorting',
    kind: 'related',
    prompt:
      'Make the role column sortable in src/user-table.tsx and wire controlled TanStack Table sorting state so clicking the role header toggles sorting.',
    expectedSkillArea: 'table-v9',
    validation: 'table-v9',
  },
  {
    id: 'unrelated-sort',
    kind: 'unrelated',
    prompt:
      'Update src/lib/sort-user-ids.ts so sortUserIds returns a new numerically ascending array without mutating its input.',
    validation: 'sort-user-ids',
  },
]

const liveConditions: ReadonlyArray<LiveSessionCase['condition']> = [
  'no-intent',
  'symlink-intent',
  'mapped-intent',
  'hooked-intent',
]

export const liveSessionCases: ReadonlyArray<LiveSessionCase> =
  liveSessionProfiles.flatMap((profile) =>
    liveConditions.map((condition) => ({
      id: `${profile.id}-${condition}`,
      condition,
      fixture: 'multi-turn',
      profile,
      turns: liveSessionTurns,
    })),
  )
