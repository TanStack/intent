---
id: search-validation
title: Search Param Validation
versions:
  - latest
  - ">=1 <2"
summary: Validate search params with schema adapters.
api:
  - https://tanstack.com/router/latest/docs/guide/search-params
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Search Param Validation

Purpose:

- Validate and type search params with schemas.

Scope:

- Use when defining filters, pagination, or optional flags.

Guidelines:

- Use `validateSearch` with a schema adapter.
- Keep search values serializable.
- Avoid ad-hoc parsing in components.

Example:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  validateSearch: searchSchema,
})
```
