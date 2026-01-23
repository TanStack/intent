---
id: route-ids
title: Route IDs
versions:
  - latest
  - ">=1 <2"
summary: Keep route identifiers stable across refactors.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-ids
  - https://tanstack.com/router/latest/docs/api/router/create-route
  - https://tanstack.com/router/latest/docs/api/router/use-match
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

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  id: "projects.detail",
  path: "projects/$projectId",
})
```

```ts
const match = useMatch({ from: "projects.detail" })
```
