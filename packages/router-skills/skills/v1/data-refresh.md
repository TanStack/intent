---
id: data-refresh
title: Prefetching and Invalidation
versions:
  - latest
  - ">=1 <2"
summary: Warm data before navigation and revalidate after mutations.
resources:
  - https://tanstack.com/router/latest/docs/guide/prefetching
  - https://tanstack.com/router/latest/docs/guide/invalidation
  - https://tanstack.com/router/latest/docs/api/router/preload
  - https://tanstack.com/router/latest/docs/api/router/invalidate
---

# Prefetching and Invalidation

Purpose:

- Warm route data before navigation and revalidate after mutations.

Scope:

- Use when you can predict navigation or after data changes.

Guidelines:

- Prefetch on hover or intent to reduce perceived latency.
- Invalidate the smallest route scope that changed.
- Avoid frequent invalidation loops.
- Pair with loader caching for instant renders.

Examples:

```ts
router.preload({ to: "/projects/123" })
```

```ts
router.invalidate({ to: "/projects" })
```
