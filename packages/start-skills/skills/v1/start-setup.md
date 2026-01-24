---
id: start-setup
title: Setup
versions:
  - latest
summary: Initialize TanStack Start, pick an adapter, and boot the app.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Setup

Purpose:

- Initialize a Start application and connect it to the runtime adapter.

Scope:

- Use when creating a new Start app or upgrading an existing setup.

Guidelines:

- Decide the adapter early (Node, edge, or serverless) to match deployment constraints.
- Keep server-only modules separated from client bundles.
- Establish entry points early so routing and SSR wiring stay consistent.
- Document how environment variables map to the chosen adapter runtime.
- For routing, follow `@skills/router/router-setup` and `@skills/router/route-trees`.

Examples:

```ts
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

export default defineStartApp({
  router,
  adapter,
})
```
