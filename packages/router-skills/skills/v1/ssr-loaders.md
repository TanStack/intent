---
id: ssr-loaders
title: SSR Loaders
versions:
  - latest
  - ">=1 <2"
summary: Keep loader data SSR-safe for hydration.
api:
  - https://tanstack.com/router/latest/docs/guide/ssr
  - https://tanstack.com/router/latest/docs/guide/loaders
---

# SSR Loaders

Purpose:

- Ensure loader data is safe to serialize and hydrate.

Scope:

- Use when enabling SSR or streaming.

Guidelines:

- Return serializable values from loaders.
- Avoid browser-only APIs in loaders.
- Keep server-only dependencies in context.

Example:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  loader: ({ context }) => context.api.getSettings(),
})
```
