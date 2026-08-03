import type { ExpectedSkillArea, IntentDiscoveryFixture } from './tasks'

type IntentDiscoveryFixtureDefinition = {
  skillAreas: Array<ExpectedSkillArea>
  files: Array<string>
}

export const fixtures: Record<
  IntentDiscoveryFixture,
  IntentDiscoveryFixtureDefinition
> = {
  'multi-turn': {
    skillAreas: ['router', 'start', 'table-v9'],
    files: [
      'package.json',
      'src/lib/format-display-name.ts',
      'src/format-table-heading.ts',
      'src/lib/sort-user-ids.ts',
      'src/routes/users.$userId.tsx',
      'src/routes/users.tsx',
      'src/user-table.tsx',
    ],
  },
  'router-basic': {
    skillAreas: ['router'],
    files: ['package.json', 'src/routes/users.$userId.tsx'],
  },
  'start-basic': {
    skillAreas: ['start'],
    files: ['package.json', 'src/routes/users.tsx'],
  },
  'table-v9-basic': {
    skillAreas: ['table-v9'],
    files: ['package.json', 'src/user-table.tsx'],
  },
}
