---
id: observability
title: Observability
versions:
  - latest
summary: Instrument Start apps for logging and tracing.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Observability

Purpose:

- Add logging, metrics, and tracing around Start runtime logic.

Scope:

- Use when instrumenting server functions, middleware, and adapters.

Guidelines:

- Instrument middleware and server functions first.
- Use `@skills/router/router-devtools` for routing diagnostics.
- Ensure observability tooling supports the hosting runtime.

Examples:

```ts
export const middleware = defineMiddleware(async (request, next) => {
  const start = Date.now()
  const response = await next(request)
  logRequest({ path: request.url, ms: Date.now() - start })
  return response
})
```
