---
id: not-found-boundaries
title: Not-Found Boundaries
versions:
  - latest
  - ">=1 <2"
summary: Handle missing data or unmatched routes.
resources:
  - https://tanstack.com/router/latest/docs/guide/not-found
  - https://tanstack.com/router/latest/docs/api/router/create-route
  - https://tanstack.com/router/latest/docs/api/router/not-found
---

# Not-Found Boundaries

Purpose:

- Render fallbacks for missing data or unmatched routes.

Scope:

- Use when a route can return "not found" states.

Guidelines:

- Place not-found boundaries near the routes they protect.
- Keep not-found UI consistent within a layout.
- Use loaders to decide when data is missing.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId",
  notFoundComponent: ProjectNotFound,
})
```

```ts
throw notFound({ routeId: "projects.detail" })
```
