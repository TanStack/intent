---
id: router-state
title: Router State
versions:
  - latest
  - ">=1 <2"
summary: Read pending navigation and status.
resources:
  - https://tanstack.com/router/latest/docs/guide/router-state
  - https://tanstack.com/router/latest/docs/api/router/use-router-state
---

# Router State

Purpose:

- Read navigation state for pending UI.

Scope:

- Use when showing loading indicators or transitions.

Guidelines:

- Show global pending UI sparingly.
- Prefer route-level pending states when possible.
- Avoid blocking navigation on long transitions.

Example:

```ts
const state = useRouterState()
const isLoading = state.isLoading
```
