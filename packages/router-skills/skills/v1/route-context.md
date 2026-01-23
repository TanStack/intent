---
id: route-context
title: Route Context
versions:
  - latest
  - ">=1 <2"
summary: Pass shared dependencies into loaders and routes.
api:
  - https://tanstack.com/router/latest/docs/guide/router-context
---

# Route Context

Purpose:

- Share dependencies across loaders and hooks.

Scope:

- Use when providing API clients or caches.

Guidelines:

- Define context once at router creation.
- Keep context stable across navigations.
- Use context in loaders to avoid module globals.

Example:

```ts
const router = createRouter({
  routeTree,
  context: { api, queryClient },
})
```
