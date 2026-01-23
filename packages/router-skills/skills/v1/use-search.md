---
id: use-search
title: useSearch
versions:
  - latest
  - ">=1 <2"
summary: Read typed search params for a route.
resources:
  - https://tanstack.com/router/latest/docs/guide/search-params
  - https://tanstack.com/router/latest/docs/api/router/use-search
---

# useSearch

Purpose:

- Read typed search params for a route.

Scope:

- Use when consuming validated search state.

Guidelines:

- Pair with `validateSearch` schemas.
- Prefer route-scoped search reads.
- Keep search state serializable.

Example:

```ts
const search = route.useSearch()
```
