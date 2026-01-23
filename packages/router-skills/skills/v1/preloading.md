---
id: preloading
title: Preloading
versions:
  - latest
  - ">=1 <2"
summary: Preload route data and code before navigation.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/preloading
  - https://tanstack.com/router/latest/docs/api/router/preload
---

# Preloading

Purpose:

- Preload route data and code before navigation.

Scope:

- Use when you can anticipate a navigation target.

Guidelines:

- Trigger preload on hover or intent.
- Keep preloads targeted to avoid extra work.
- Pair with lazy routes for smoother transitions.

Examples:

```ts
router.preload({ to: "/projects/123" })
```

```tsx
<Link to="/projects" preload="intent" />
```
