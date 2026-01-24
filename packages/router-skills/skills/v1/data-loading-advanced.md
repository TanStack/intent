---
id: data-loading-advanced
title: Advanced Data Loading
versions:
  - latest
  - ">=1 <2"
summary: Handle deferred, external, and mutation-driven data flows.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
  - https://tanstack.com/router/latest/docs/framework/react/guide/deferred-data-loading
  - https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading
  - https://tanstack.com/router/latest/docs/framework/react/guide/data-mutations
---

# Advanced Data Loading

Purpose:

- Model deferred data, external data sources, and mutation flows.

Scope:

- Use when data cannot all load upfront or needs mutation handling.

Guidelines:

- Defer non-critical data to keep first paint fast.
- Use external caches (Query, custom stores) for shared state.
- Trigger invalidation after mutations to refresh loaders.
- Keep mutation side effects predictable and localized.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard",
  loader: async () => ({
    summary: await fetchSummary(),
    detailsPromise: fetchDetails()
  }),
})
```

```ts
await mutateProject(projectId, payload)
router.invalidate()
```
