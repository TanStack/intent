---
id: route-meta
title: Route Meta
versions:
  - latest
  - ">=1 <2"
summary: Attach metadata to routes for UI or analytics.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-meta
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Route Meta

Purpose:

- Attach metadata to routes for UI or analytics.

Scope:

- Use when you need titles, breadcrumbs, or flags per route.

Guidelines:

- Keep meta serializable.
- Use meta for UI hints, not data fetching.
- Read meta from matches when needed.

Example:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  meta: { title: "Projects" },
})
```
