---
id: authentication
title: Authentication
versions:
  - latest
summary: Define auth boundaries and implement login flows.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Authentication

Purpose:

- Define authentication boundaries and implement login flows.

Scope:

- Use when planning sessions, cookies, providers, or token storage.

Guidelines:

- Keep auth checks in middleware or server functions, not client-only code.
- Use `@skills/router/authenticated-routes` for route guards and redirects.
- Align session storage with the chosen adapter runtime.

Examples:

```ts
export const login = serverFn(async (input) => {
  const user = await verifyCredentials(input)
  return createSession(user)
})
```
