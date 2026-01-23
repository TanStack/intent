---
id: start-setup
title: Start Setup
versions:
  - latest
  - ">=1 <2"
summary: Initialize TanStack Start, pick an adapter, and boot the app.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start Setup

Purpose:

- Initialize a Start application and connect it to the runtime adapter.

Scope:

- Use when creating a new Start app or upgrading an existing setup.

Guidelines:

- Decide the adapter early (Node, edge, or serverless) to match deployment constraints.
- Keep server-only modules separated from client bundles.
- For routing, follow `@skills/router/router-setup` and `@skills/router/route-trees`.

Examples:

```ts
export default defineStartApp({
  router,
  adapter,
})
```
