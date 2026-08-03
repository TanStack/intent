import type { ExpectedSkillArea } from './tasks'

export const skillByArea = {
  router: {
    packageName: '@tanstack/router',
    name: 'routing',
    description:
      'TanStack Router route loaders, route params, pending states, and loader data consumption.',
    guidance: [
      'Use route loaders for data required before rendering.',
      'Read route params from the loader context and throw when a fetch response is not OK.',
      'Read loader data through `Route.useLoaderData()` in the route component.',
    ].join('\n'),
  },
  start: {
    packageName: '@tanstack/start',
    name: 'server-functions',
    description:
      'TanStack Start server functions, handlers, validation, and route loader integration.',
    guidance: [
      "Define GET server functions with `createServerFn({ method: 'GET' }).handler(...)`.",
      'Call the server function from the route loader.',
      'Read loader data through `Route.useLoaderData()` in the route component.',
    ].join('\n'),
  },
  'table-v9': {
    packageName: '@tanstack/table',
    name: 'v9-columns',
    description:
      'TanStack Table v9 column definitions, controlled sorting state, sorting handlers, and row models.',
    guidance: [
      'Keep sorting in controlled `SortingState` state.',
      'Pass `state.sorting`, `onSortingChange`, and `getSortedRowModel()` to the table.',
      "Use the target column's `getToggleSortingHandler()` from an interactive header control.",
    ].join('\n'),
  },
} satisfies Record<
  ExpectedSkillArea,
  {
    description: string
    guidance: string
    name: string
    packageName: string
  }
>

export function skillUse(area: ExpectedSkillArea): string {
  const skill = skillByArea[area]
  return `${skill.packageName}#${skill.name}`
}
