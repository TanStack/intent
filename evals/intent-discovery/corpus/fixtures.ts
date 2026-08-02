import type { ExpectedSkillArea, IntentDiscoveryFixture } from './tasks'

export type IntentDiscoveryFixtureDefinition = {
  id: IntentDiscoveryFixture
  purpose: string
  skillAreas: Array<ExpectedSkillArea>
  files: Array<string>
}

export const fixtures = {
  'multi-turn': {
    id: 'multi-turn',
    purpose:
      'Persistent unrelated, Router, Start, Table v9, and unrelated turns.',
    skillAreas: ['router', 'start', 'table-v9'],
    files: [
      'package.json',
      'src/lib/format-display-name.ts',
      'src/lib/sort-user-ids.ts',
      'src/routes/users.$userId.tsx',
      'src/routes/users.tsx',
      'src/user-table.tsx',
    ],
  },
  'router-basic': {
    id: 'router-basic',
    purpose: 'Route discovery and route loader changes.',
    skillAreas: ['router'],
    files: ['package.json', 'src/routes/users.$userId.tsx'],
  },
  'start-basic': {
    id: 'start-basic',
    purpose: 'TanStack Start server function and route loader behavior.',
    skillAreas: ['start'],
    files: ['package.json', 'src/routes/users.tsx'],
  },
  'table-v9-basic': {
    id: 'table-v9-basic',
    purpose: 'TanStack Table v9 column definitions and sorting behavior.',
    skillAreas: ['table-v9'],
    files: ['package.json', 'src/user-table.tsx'],
  },
} satisfies Record<IntentDiscoveryFixture, IntentDiscoveryFixtureDefinition>
