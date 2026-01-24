---
id: static-prerendering
title: Static Generation
versions:
  - latest
summary: Pre-render routes and run build-time logic.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Static Generation

Purpose:

- Generate static HTML and build-time data for routes.

Scope:

- Use when deploying to static hosting or precomputing data.

Guidelines:

- Keep static data deterministic and serializable.
- Use `@skills/router/static-route-data` for static data needs.
- Avoid runtime-only dependencies in build-time execution.
- Confirm adapter support for prerendering.

Examples:

```ts
export const prerenderRoutes = ['/', '/pricing', '/docs']
```
