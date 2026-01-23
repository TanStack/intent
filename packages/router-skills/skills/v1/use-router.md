---
id: use-router
title: useRouter
versions:
  - latest
  - ">=1 <2"
summary: Access the router instance for advanced control.
resources:
  - https://tanstack.com/router/latest/docs/api/router/use-router
---

# useRouter

Purpose:

- Access the router instance for advanced control.

Scope:

- Use when you need router APIs not exposed by hooks.

Guidelines:

- Prefer route hooks before reaching for router instance.
- Keep router usage centralized.
- Avoid mutating router config after creation.

Example:

```ts
const router = useRouter()
```
