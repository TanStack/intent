---
id: static-route-data
title: Static Route Data
versions:
  - latest
  - ">=1 <2"
summary: Attach static data to routes for UI hints or config.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/static-route-data
---

# Static Route Data

Purpose:

- Attach static data to routes for UI hints or configuration.

Scope:

- Use when data does not depend on params or loaders.

Guidelines:

- Keep static data serializable.
- Use static data for UI hints (labels, icons).
- Avoid mixing static data with loader results.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  staticData: { title: "Projects" },
})
```

```ts
const match = useMatch({ from: "projects" })
const title = match.staticData?.title
```
