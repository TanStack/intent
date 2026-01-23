---
id: prefetching
title: Prefetching
versions:
  - latest
  - ">=1 <2"
summary: Warm route data before navigation.
api:
  - https://tanstack.com/router/latest/docs/guide/prefetching
  - https://tanstack.com/router/latest/docs/api/router/preload
---

# Prefetching

Purpose:

- Warm route data before navigation.

Scope:

- Use when you can predict next navigation.

Guidelines:

- Prefetch on hover or intent signals.
- Avoid prefetching heavy payloads unnecessarily.
- Pair with loader cache for instant renders.

Example:

```ts
router.preload({ to: "/projects/123" })
```
