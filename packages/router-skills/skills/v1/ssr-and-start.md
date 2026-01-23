---
id: ssr-and-start
title: SSR and Start Integration
versions:
  - latest
  - ">=1 <2"
summary: Keep loaders and route code SSR-safe for TanStack Start.
api:
  - https://tanstack.com/router/latest/docs/guide/ssr
  - https://tanstack.com/start/latest/docs/overview
---

# SSR and Start Integration

Purpose:

- Keep routing and data loading SSR-safe for TanStack Start or custom SSR.

Scope:

- Use when targeting server rendering, streaming, or Start integrations.

Guidelines:

- Keep loader return values serializable for hydration.
- Avoid browser-only APIs in loaders and route hooks.
- Use route context for server-aware dependencies.

Examples:

- Server-safe loader pattern:
  ```ts
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "settings",
    loader: ({ context }) => context.api.getSettings(),
  })
  ```
