---
id: router-state
title: Router State
versions:
  - latest
  - ">=1 <2"
summary: Read router status for pending UI and transitions.
resources:
  - https://tanstack.com/router/latest/docs/guide/router-state
  - https://tanstack.com/router/latest/docs/api/router/use-router-state
---

# Router State

Purpose:

- Read router status for pending UI and transitions.

Scope:

- Use when showing loading indicators or transitions.

Guidelines:

- Show global pending UI sparingly.
- Prefer route-level pending states when possible.
- Avoid blocking navigation on long transitions.
- Use the router state to drive spinners or skeletons.

Examples:

```ts
const state = useRouterState()
const isLoading = state.isLoading
```

```tsx
{isLoading ? <LoadingBar /> : null}
```
