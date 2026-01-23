---
id: authenticated-routes
title: Authenticated Routes
versions:
  - latest
  - ">=1 <2"
summary: Gate routes behind auth and redirect when unauthenticated.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes
  - https://tanstack.com/router/latest/docs/framework/react/guide/redirects
---

# Authenticated Routes

Purpose:

- Gate routes behind auth and redirect when needed.

Scope:

- Use when a route requires a user session.

Guidelines:

- Check auth in loaders or route guards before render.
- Redirect early to avoid unauthorized flashes.
- Preserve intended destinations in search params.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "account",
  beforeLoad: ({ context }) => {
    if (!context.auth.user) throw redirect({ to: "/login" })
  },
})
```

```ts
throw redirect({ to: "/login", search: { next: "/account" } })
```
