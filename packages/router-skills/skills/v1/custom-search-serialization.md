---
id: custom-search-serialization
title: Custom Search Serialization
versions:
  - latest
  - ">=1 <2"
summary: Customize how search params are parsed and serialized.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/custom-search-param-serialization
  - https://tanstack.com/router/latest/docs/framework/react/guide/search-params
---

# Custom Search Serialization

Purpose:

- Customize how search params are parsed and serialized.

Scope:

- Use when you need non-default parsing or encoding.

Guidelines:

- Keep serialization stable and reversible.
- Prefer schema adapters for validation.
- Document custom encoding for other teams.

Examples:

```ts
const router = createRouter({
  routeTree,
  parseSearch: (search) => customParse(search),
  stringifySearch: (search) => customStringify(search),
})
```

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "filters",
  validateSearch: searchSchema,
})
```
