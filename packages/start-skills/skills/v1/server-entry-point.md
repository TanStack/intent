---
id: server-entry-point
title: Entry Points
versions:
  - latest
summary: Configure client and server entry points.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Entry Points

Purpose:

- Wire client hydration and server rendering.

Scope:

- Use when customizing client and server entry files.

Guidelines:

- Keep entry points focused on runtime wiring, not route definitions.
- Keep adapter wiring in the server entry layer.
- Use `@skills/router/router-setup` for Router initialization.
- Coordinate hydration data with `@skills/router/ssr-loaders`.

Examples:

```ts
// entry-client.tsx
hydrateRoot(document, <App router={router} />)

// entry-server.tsx
const html = await renderToString(<App router={router} />)
```
