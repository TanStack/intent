---
id: type-safety
title: Type Safety and Utilities
versions:
  - latest
  - ">=1 <2"
summary: Keep routes, params, and search types consistent.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/type-safety
  - https://tanstack.com/router/latest/docs/framework/react/guide/type-utilities
---

# Type Safety and Utilities

Purpose:

- Keep routes, params, and search types consistent.

Scope:

- Use when tightening type coverage or debugging inference.

Guidelines:

- Prefer typed route helpers over manual strings.
- Use type utilities to extract route param or search types.
- Keep search schemas aligned with validation.

Examples:

```ts
type Search = typeof route.types.search
```

```ts
type Params = typeof route.types.params
```
