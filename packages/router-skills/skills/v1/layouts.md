---
id: layouts
title: Layout Routes
versions:
  - latest
  - ">=1 <2"
summary: Use layout routes to share UI and state.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-trees
  - https://tanstack.com/router/latest/docs/guide/route-layouts
---

# Layout Routes

Purpose:

- Share UI, loaders, and boundaries across child routes.

Scope:

- Use when multiple routes need the same shell UI.

Guidelines:

- Place shared navigation and chrome on layout routes.
- Keep layout loaders limited to shared data.
- Keep layouts stable to avoid remount churn.

Example:

```ts
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "app",
  component: AppLayout,
})
```
