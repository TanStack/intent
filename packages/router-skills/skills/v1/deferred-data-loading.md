---
id: deferred-data-loading
title: Deferred Data Loading
versions:
  - latest
  - ">=1 <2"
summary: Defer non-critical data to keep initial render fast.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/deferred-data-loading
  - https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
---

# Deferred Data Loading

Purpose:

- Defer non-critical data to keep initial render fast.

Scope:

- Use when part of the route data can load after render.

Guidelines:

- Load critical data in the loader immediately.
- Defer secondary data to avoid blocking.
- Handle loading states for deferred data.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard",
  loader: async () => ({
    summary: await fetchSummary(),
    detailsPromise: fetchDetails(),
  }),
})
```

```tsx
const { summary, detailsPromise } = route.useLoaderData()
```
