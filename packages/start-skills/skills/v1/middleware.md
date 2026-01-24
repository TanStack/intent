---
id: middleware
title: Middleware
versions:
  - latest
summary: Add request/response middleware for authentication and headers.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Middleware

Purpose:

- Centralize auth, logging, and request transforms.

Scope:

- Use for cross-cutting concerns across all routes and server functions.

Guidelines:

- Keep middleware side-effect free where possible.
- Avoid router-specific logic; delegate to `@skills/router/authenticated-routes`.
- Ensure middleware stays compatible with the chosen adapter runtime.

Examples:

```ts
export const middleware = defineMiddleware(async (request, next) => {
  const requestId = crypto.randomUUID()
  return next(request, { headers: { 'x-request-id': requestId } })
})
```
