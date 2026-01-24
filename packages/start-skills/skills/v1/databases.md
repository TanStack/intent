---
id: databases
title: Databases
versions:
  - latest
summary: Access databases safely in Start apps.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Databases

Purpose:

- Keep database access on the server while keeping types aligned.

Scope:

- Use when introducing database clients or query layers.

Guidelines:

- Initialize database clients in server-only modules.
- Expose data through server functions or `@skills/router/loaders`.
- Align connection pooling with the adapter runtime.

Examples:

```ts
export const listProjects = serverFn(async () => {
  return db.project.findMany()
})
```
