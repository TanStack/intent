---
id: redirects
title: Redirects
versions:
  - latest
  - ">=1 <2"
summary: Redirect from loaders or actions.
resources:
  - https://tanstack.com/router/latest/docs/guide/redirects
  - https://tanstack.com/router/latest/docs/api/router/redirect
---

# Redirects

Purpose:

- Redirect from loaders or actions.

Scope:

- Use when gating routes or handling auth flows.

Guidelines:

- Redirect early in loaders to avoid flashes.
- Preserve intent with `search` or `hash`.
- Avoid redirect loops.

Examples:

```ts
throw redirect({ to: "/login" })
```

```ts
throw redirect({ to: "/login", search: { next: "/projects" } })
```
