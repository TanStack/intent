---
id: external-data-loading
title: External Data Loading
versions:
  - latest
  - ">=1 <2"
summary: Integrate external caches with loader-driven routing.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading
  - https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
---

# External Data Loading

Purpose:

- Integrate external caches with loader-driven routing.

Scope:

- Use when using TanStack Query or other caches.

Guidelines:

- Prefetch into the external cache inside loaders.
- Read data from the cache in components.
- Invalidate routes after mutations as needed.

Examples:

```ts
loader: async ({ context }) => {
  await context.queryClient.prefetchQuery(projectsQuery())
}
```

```ts
const projects = useQuery(projectsQuery())
```
