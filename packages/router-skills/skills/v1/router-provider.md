---
id: router-provider
title: Router Provider
versions:
  - latest
  - ">=1 <2"
summary: Register the router with your app entrypoint.
resources:
  - https://tanstack.com/router/latest/docs/guide/installation
  - https://tanstack.com/router/latest/docs/api/router/router-provider
---

# Router Provider

Purpose:

- Register the router with your app entrypoint.

Scope:

- Use when wiring the router into React, Solid, or Vue roots.

Guidelines:

- Create the router once at startup.
- Provide route context dependencies at creation.
- Keep provider near the root layout.

Example:

```tsx
const router = createRouter({ routeTree })
<RouterProvider router={router} />
```
