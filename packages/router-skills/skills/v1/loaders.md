---
id: loaders
title: Route Loaders
versions:
  - latest
  - ">=1 <2"
summary: Fetch route-critical data before render.
resources:
  - https://tanstack.com/router/latest/docs/guide/loaders
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Route Loaders

Purpose:

- Fetch route-critical data before render.

Scope:

- Use when data must be ready for first paint.

Guidelines:

- Keep loaders focused on required data.
- Return serializable values when SSR is needed.
- Use loader context for dependencies.

Example:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  loader: ({ context }) => context.api.getProjects(),
})
```
