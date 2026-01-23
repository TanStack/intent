---
id: search-params
title: Search Params
versions:
  - latest
  - ">=1 <2"
summary: Validate, default, and read search params.
resources:
  - https://tanstack.com/router/latest/docs/guide/search-params
  - https://tanstack.com/router/latest/docs/api/router/create-route
  - https://tanstack.com/router/latest/docs/api/router/use-search
---

# Search Params

Purpose:

- Validate, default, and read search params consistently.

Scope:

- Use for filters, pagination, and optional flags in the URL.

Guidelines:

- Use `validateSearch` with a schema adapter for type safety.
- Define defaults in the schema for stable URLs.
- Keep search values serializable and small.
- Use route-scoped `useSearch` to read validated values.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  validateSearch: searchSchema,
})
```

```ts
const searchSchema = z.object({
  page: z.number().default(1),
  filter: z.string().optional(),
})
```

```ts
const search = route.useSearch()
```
