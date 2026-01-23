---
id: router-setup
title: Router Setup
versions:
  - latest
  - ">=1 <2"
summary: Create the router, provide context, and mount it in the app.
resources:
  - https://tanstack.com/router/latest/docs/guide/installation
  - https://tanstack.com/router/latest/docs/api/router/create-router
  - https://tanstack.com/router/latest/docs/api/router/router-provider
  - https://tanstack.com/router/latest/docs/api/router/use-router
---

# Router Setup

Purpose:

- Create the router instance, provide shared context, and mount it.

Scope:

- Use when initializing a Router app or adding Router to an existing app.

Guidelines:

- Create the router once at app startup.
- Provide shared dependencies (API clients, caches) in router context.
- Mount the provider near the root of the app.
- Use the router instance directly only for advanced cases.

Examples:

```ts
const router = createRouter({ routeTree, context: { api } })
```

```tsx
<RouterProvider router={router} />
```

```ts
const router = useRouter()
```
