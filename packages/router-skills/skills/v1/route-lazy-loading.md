---
id: route-lazy-loading
title: Route Lazy Loading
versions:
  - latest
  - ">=1 <2"
summary: Split route code to reduce initial bundle size.
resources:
  - https://tanstack.com/router/latest/docs/guide/code-splitting
---

# Route Lazy Loading

Purpose:

- Split route code to reduce initial bundle size.

Scope:

- Use when routes are large or rarely visited.

Guidelines:

- Lazy-load route components and loaders together.
- Keep critical routes eager.
- Pair with prefetching for smooth UX.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "reports",
  component: () => import("./Reports").then((m) => m.Route),
})
```

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "analytics",
  component: () => import("./Analytics").then((m) => m.AnalyticsPage),
})
```
