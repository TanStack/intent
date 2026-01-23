---
id: params
title: Route Params
versions:
  - latest
  - ">=1 <2"
summary: Work with path params safely.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-params
  - https://tanstack.com/router/latest/docs/api/router/use-params
---

# Route Params

Purpose:

- Read and type-check path params, including splats.

Scope:

- Use when accessing `$param` segments or splat params in routes.

Guidelines:

- Keep params in the path, not in search.
- Validate or coerce params in loaders if needed.
- Use router hooks to read params.
- Use splats only for catch-all routes.

Examples:

```ts
const { projectId } = route.useParams()
```

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "docs/*splat",
})
```
