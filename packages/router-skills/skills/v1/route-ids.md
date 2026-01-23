---
id: route-ids
title: Route IDs
versions:
  - latest
  - ">=1 <2"
summary: Keep route identifiers stable across refactors.
api:
  - https://tanstack.com/router/latest/docs/guide/route-ids
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Route IDs

Purpose:

- Keep route identifiers stable across path changes.

Scope:

- Use when linking routes or targeting route-level APIs.

Guidelines:

- Prefer explicit IDs for long-lived routes.
- Avoid deriving IDs from paths that may change.
- Keep IDs short and human-readable.

Example:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  id: "projects.detail",
  path: "projects/$projectId",
})
```
