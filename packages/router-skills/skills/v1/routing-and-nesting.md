---
id: routing-and-nesting
title: Routing and Nesting
versions:
  - latest
  - ">=1 <2"
summary: Define route trees and nested layouts with stable route IDs.
api:
  - https://tanstack.com/router/latest/docs/guide/route-trees
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Routing and Nesting

Purpose:

- Define route trees and nested layouts clearly and consistently.

Scope:

- Use when establishing route hierarchy and layout boundaries.

Guidelines:

- Start from a root route, then add child routes for layouts.
- Prefer explicit route IDs to avoid path-driven churn.
- Keep params in the path; use search params for optional state.

Examples:

- Basic tree:
  ```ts
  const rootRoute = createRootRoute({ component: RootLayout })
  const appRoute = createRoute({ getParentRoute: () => rootRoute, path: "app" })
  const projectRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "projects/$projectId",
  })
  ```
