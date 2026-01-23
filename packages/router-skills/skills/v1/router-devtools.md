---
id: router-devtools
title: Router Devtools
versions:
  - latest
  - ">=1 <2"
summary: Inspect routes, matches, and loader data.
resources:
  - https://tanstack.com/router/latest/docs/devtools
---

# Router Devtools

Purpose:

- Inspect routes, matches, and loader data.

Scope:

- Use during development to debug navigation.

Guidelines:

- Enable devtools only in dev builds.
- Use it to verify loader data and matches.
- Keep it out of production bundles.

Examples:

```tsx
<RouterDevtools position="bottom-right" />
```

```tsx
{import.meta.env.DEV ? <RouterDevtools /> : null}
```
