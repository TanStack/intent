---
id: route-context
title: Route Context
versions:
  - latest
  - ">=1 <2"
summary: Pass shared dependencies into loaders and routes.
resources:
  - https://tanstack.com/router/latest/docs/guide/router-context
  - https://tanstack.com/router/latest/docs/api/router/use-route-context
---

# Route Context

Purpose:

- Share dependencies across loaders and hooks.

Scope:

- Use when providing API clients, caches, or environment data.

Guidelines:

- Define context once at router creation.
- Keep context stable across navigations.
- Use context in loaders to avoid module globals.
- Read context with route hooks instead of imports.

Examples:

```ts
const router = createRouter({
  routeTree,
  context: { api, queryClient },
})
```

```ts
const { api } = route.useRouteContext()
```
