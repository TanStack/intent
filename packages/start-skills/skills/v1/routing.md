---
id: routing
title: Routing
versions:
  - latest
summary: Connect Start to Router-based routing.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Routing

Purpose:

- Integrate Start runtime concerns with Router routing.

Scope:

- Use when defining routes or deciding on routing strategies.

Guidelines:

- Build route definitions with `@skills/router/route-trees`.
- Use `@skills/router/file-based-routing` for file-driven routing.
- Follow `@skills/router/routing-strategies` for route structure choices.

Examples:

```ts
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})
```
