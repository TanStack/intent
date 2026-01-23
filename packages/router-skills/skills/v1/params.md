---
id: params
title: Route Params
versions:
  - latest
  - ">=1 <2"
summary: Work with path params safely.
api:
  - https://tanstack.com/router/latest/docs/guide/route-params
  - https://tanstack.com/router/latest/docs/api/router/use-params
---

# Route Params

Purpose:

- Read and type-check path params.

Scope:

- Use when accessing `$param` segments in routes.

Guidelines:

- Keep params in the path, not in search.
- Validate or coerce params in loaders if needed.
- Use router hooks to read params.

Example:

```ts
const { projectId } = route.useParams()
```
