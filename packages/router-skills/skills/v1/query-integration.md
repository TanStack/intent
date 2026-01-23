---
id: query-integration
title: TanStack Query Integration
versions:
  - latest
  - ">=1 <2"
summary: Integrate Router with TanStack Query for caching.
resources:
  - https://tanstack.com/router/latest/docs/integrations/query
---

# TanStack Query Integration

Purpose:

- Integrate Router with TanStack Query for caching and prefetching.

Scope:

- Use when you want Query-managed caches with Router loaders.

Guidelines:

- Provide the Query client in router context.
- Prefetch queries in loaders.
- Invalidate queries after mutations.

Examples:

```ts
const router = createRouter({ routeTree, context: { queryClient } })
```

```ts
await queryClient.prefetchQuery(projectsQuery())
```
