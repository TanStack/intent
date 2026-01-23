---
id: route-masking
title: Route Masking
versions:
  - latest
  - ">=1 <2"
summary: Present friendly URLs without changing route structure.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-masking
---

# Route Masking

Purpose:

- Present friendly URLs without changing route structure.

Scope:

- Use when exposing public paths for internal routes.

Guidelines:

- Define masks for user-friendly URLs.
- Keep masks aligned with params and search.
- Document masks to avoid confusion.

Example:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId",
  mask: "/p/$projectId",
})
```
