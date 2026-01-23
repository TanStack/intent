---
id: search-params
title: Search Params and Validation
versions:
  - latest
  - ">=1 <2"
summary: Define and validate search params with schema adapters.
api:
  - https://tanstack.com/router/latest/docs/guide/search-params
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Search Params and Validation

Purpose:

- Keep search params typed, validated, and serialized consistently.

Scope:

- Use for filters, pagination, and optional flags.

Guidelines:

- Use `validateSearch` with a schema adapter and defaults.
- Keep search values small and serializable.
- Avoid ad-hoc parsing in components.

Examples:

- Schema-backed search:
  ```ts
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects",
    validateSearch: searchSchema,
  })
  ```
