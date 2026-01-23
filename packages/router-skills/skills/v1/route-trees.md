---
id: route-trees
title: Route Trees
versions:
  - latest
  - ">=1 <2"
summary: Define the parent-child route tree.
api:
  - https://tanstack.com/router/latest/docs/guide/route-trees
  - https://tanstack.com/router/latest/docs/api/router/create-root-route
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Route Trees

Purpose:

- Define the parent-child route tree.

Scope:

- Use when establishing the overall route hierarchy.

Guidelines:

- Start with a root route, then add children.
- Keep parent routes responsible for shared UI.
- Keep the tree shallow unless layouts require depth.

Example:

```ts
const rootRoute = createRootRoute({ component: RootLayout })
const appRoute = createRoute({ getParentRoute: () => rootRoute, path: "app" })
const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "projects/$projectId",
})
```
