---
id: environment-config
title: Environment
versions:
  - latest
summary: Configure environment variables and runtime helpers.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Environment

Purpose:

- Define environment variables and runtime helpers safely.

Scope:

- Use when wiring environment variables, secrets, and runtime helpers.

Guidelines:

- Validate required environment variables at startup.
- Keep secrets server-only and never expose them to client bundles.
- Keep environment helpers in server entry files or server functions.
- Validate helpers against the selected adapter runtime.

Examples:

```ts
const requireEnv = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}

export const env = {
  databaseUrl: requireEnv('DATABASE_URL'),
}
```
