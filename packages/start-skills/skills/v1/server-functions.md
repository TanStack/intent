---
id: server-functions
title: Server Functions
versions:
  - latest
summary: Create typed server functions with secure inputs and outputs.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Server Functions

Purpose:

- Implement server-only logic with typed boundaries.

Scope:

- Use for mutations, data fetching, or sensitive operations.

Guidelines:

- Validate inputs before executing server logic.
- Return serializable data for hydration and streaming.
- Use `@skills/router/loaders` for route-level data reads.
- Coordinate cache invalidation with `@skills/router/data-refresh`.

Examples:

```ts
export const updateProfile = serverFn(async (input) => {
  await requireSession()
  return updateUser(input)
})
```
