---
id: execution-model
title: Execution Model
versions:
  - latest
summary: Understand where Start code executes.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Execution Model

Purpose:

- Clarify what runs on the server, client, or both.

Scope:

- Use when debugging execution context and data flow.

Guidelines:

- Keep server-only logic in entry points and server functions.
- Use server functions or `@skills/router/loaders` for data fetching.
- Avoid importing server-only modules in client entry files.
- Avoid relying on browser-only APIs during SSR.

Examples:

```ts
// server-only module
export async function readSecrets() {
  return loadFromVault()
}

// server function uses the server-only module
export const getSession = serverFn(async () => readSecrets())
```
