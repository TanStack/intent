---
id: loaders-and-prefetching
title: Loaders and Prefetching
versions:
  - latest
  - ">=1 <2"
summary: Fetch route-critical data before render and prefetch navigation.
api:
  - https://tanstack.com/router/latest/docs/guide/loaders
  - https://tanstack.com/router/latest/docs/api/router/preload
---

# Loaders and Prefetching

Purpose:

- Centralize route-critical data fetching and keep navigation fast.

Scope:

- Use when adding loaders or prefetching navigation.

Guidelines:

- Put required data in loaders so it is available before render.
- Use route context for dependencies (API clients, query clients).
- Prefetch likely navigation targets to reduce latency.

Examples:

- Loader with prefetch:
  ```ts
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects/$projectId",
    loader: ({ context, params }) =>
      context.queryClient.prefetchQuery(projectQuery(params.projectId)),
  })
  ```
